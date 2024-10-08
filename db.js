const mysql = require('promise-mysql');
const request = require('request');
module.exports = class DB {
    static async create({
        host,
        port,
        user,
        password,
        dbname,
    }) {
        const pool = await mysql.createPool({
            host,
            port,
            user,
            password,
            database: dbname,
            charset: 'utf8mb4',
            //debug :true
        });
        return new DB({ pool });
    }

    /**
     * @param {Object} options
     * @param {mysql.Pool?} options.pool
     * @param {mysql.PoolConnection?} options.poolConnection
     */
    constructor({ pool, poolConnection }) {
        if (pool && poolConnection) {
            throw new Error('pool 跟 poolConnection 只能選一個傳入');
        }
        if (pool) {
            this.pool = pool;
            this.usePool = true;
        } else if (poolConnection) {
            this.poolConnection = poolConnection;
            this.usePool = false;
        } else {
            throw new Error('pool 跟 poolConnection 必須選一個傳入');
        }
    }

    get db() {
        if (this.usePool) {
            return this.pool;
        }
        return this.poolConnection;
    }

    /**
     * @callback DoWithTransactionDb
     * @param {DB} db Transaction 專用 DB instance
     * @returns {Promise<void>}
     */

    /**
     * 取得一 connection 並開始一個新的 transaction。
     * @param {DoWithTransactionDb} fn
     * 在此 function 內的對 db 做的動作都將視為 transaction 的一部分，
     * 執行完後會自動 commit。執行過程中若拋出例外將自動 rollback。
     * @returns {Promise<void>}
     */
    async withTransaction(fn) {
        if (!this.usePool) {
            throw new Error('此 DB instance 已為 transaction 專用。');
        }
        let conn = await this.pool.getConnection();
        let transactionDb = new DB({ poolConnection: conn });
        try {
            await conn.beginTransaction();
            await fn(transactionDb);
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    /**
     * @param {string} email 
     * @returns {Promise<boolean>}
     */
    async isEmailRegistered(email) {
        const results = await this.db.query(
            'SELECT COUNT(*) as count FROM users WHERE email = ?',
            email,
        );
        return results[0].count > 0;
    }

    async setEmailVerificationToken(email, token) {
        let fields = {
            email,
            token,
            created_at: Date.now(),
            used_at: null,
        };
        await this.db.query(
            'REPLACE INTO email_verification_codes SET ?',
            fields,
        );
    }

    async getEmailVerificationToken(email) {
        let columns = ['email', 'token', 'created_at', 'used_at'];
        let results = await this.db.query(
            'SELECT ?? FROM email_verification_codes WHERE email = ?',
            [columns, email],
        );
        if (!results.length) return null;
        return results[0];
    }

    async markEmailVerificationTokenAsUsed(email) {
        await this.db.query(
            'UPDATE email_verification_codes SET ? WHERE email = ?',
            [{ used_at: Date.now() }, email],
        );
    }

    /**
     * 
     * @param {string} email 
     * @param {number} when 
     * @returns {Promise<number>} Number of attempts
     */
    async getSendVerificationEmailAttemptsSince(email, when) {
        let results = await this.db.query(
            'SELECT COUNT(*) as count FROM send_verification_email_attempts WHERE email = ? AND created_at > ?',
            [email, when],
        );
        return results[0].count;
    }

    async recordSendEmailVerificationAttempt(email) {
        await this.db.query(
            'INSERT INTO send_verification_email_attempts SET ?',
            { email, created_at: Date.now() },
        );
    }

    async addUser(email, password) {
        await this.db.query(
            'INSERT INTO users SET ?',
            { email, password, created_at: Date.now() },
        );
    }

    async setUserPassword(email, password) {
        await this.db.query(
            'UPDATE users SET ? WHERE email = ?',
            [{ password }, email],
        );
    }

    /**
     * @param {number} id 
     */
    async getUser(id) {
        let results = await this.db.query(
            `
            SELECT u.id, u.email, u.phone, u.profile_completed, ud.nickname
            FROM users u
            LEFT JOIN user_details ud ON ud.user_id = u.id
            WHERE u.id = ?
            `,
            id,
        );
        if (!results.length) return null;
        return results[0];
    }

    async getUserByEmail(email) {
        let results = await this.db.query(
            'SELECT id, email, phone, password, profile_completed FROM users WHERE email = ?',
            email,
        );
        if (!results.length) return null;
        return results[0];
    }

    async hasUserWithPhone(phone) {
        let results = await this.db.query(
            'SELECT COUNT(*) as count FROM users WHERE phone = ?',
            phone,
        );
        return results[0].count !== 0;
    }

    async markPhoneVerificationCodeAsUsed(userId) {
        await this.db.query(
            'UPDATE phone_verification_codes SET ? WHERE user_id = ?',
            [{ used_at: Date.now() }, userId],
        );
    }

    /**
     * 
     * @param {number} userId 
     * @param {?string} phone 
     * @param {number} when 
     * @returns {Promise<number[]>} unixEpochMs of every attempt
     */
    async getSendVerificationSmsAttemptsForUserOrPhoneSince(userId, phone, when) {
        let results;
        if (phone) {
            results = await this.db.query(
                'SELECT created_at FROM send_sms_attempts WHERE (user_id = ? OR phone = ?) AND created_at > ?',
                [userId, phone, when],
            );
        } else {
            results = await this.db.query(
                'SELECT created_at FROM send_sms_attempts WHERE user_id = ? AND created_at > ?',
                [userId, when],
            );
        }
        return results.map(res => res.created_at);
    }

    /**
     * 
     * @param {number} userId
     */
    async getPhoneVerificationCodeForUser(userId) {
        let results = await this.db.query(
            'SELECT code, created_at, used_at, phone FROM phone_verification_codes WHERE user_id = ?',
            userId,
        );
        if (!results.length) return null;
        return results[0];
    }

    /**
     * 
     * @param {number} userId
     * @returns {Promise<number>} Number of attempts
     */
    async getPresentPhoneVerificationCodeAttemptsForUserSince(userId, when) {
        let results = await this.db.query(
            'SELECT created_at FROM present_phone_verification_code_attempts WHERE user_id = ? AND created_at > ?',
            [userId, when],
        );
        return results.map(res => res.created_at);
    }

    async setPhoneVerificationCode(userId, code, phone) {
        let fields = {
            user_id: userId,
            code,
            phone,
            created_at: Date.now(),
            used_at: null,
        };
        await this.db.query(
            'REPLACE INTO phone_verification_codes SET ?',
            fields,
        );
    }

    async recordSendVerificationSmsAttempt(userId, phone) {
        await this.db.query(
            'INSERT INTO send_sms_attempts SET ?',
            { user_id: userId, phone, created_at: Date.now() },
        );
    }

    async recordPresentPhoneVerificationCodeAttempt(userId, phone) {
        await this.db.query(
            'INSERT INTO present_phone_verification_code_attempts SET ?',
            { user_id: userId, phone, created_at: Date.now() },
        );
    }

    async setUserPhone(userId, phone) {
        await this.db.query(
            'UPDATE users SET ? WHERE id = ?',
            [{ phone }, userId],
        );
    }

    async setUserProfile(user_id, data)
    {
        // save to user_details
        await this.db.query(
            'INSERT INTO user_details SET ?',
            {user_id: user_id, name: data.name, nickname: data.nickname,
            gender: data.gender, birthday: data.birthday, height: data.height,
            weight: data.weight, weekly_avg_hours: data.avgHours}
        )

        // update phone
        await this.setUserPhone(user_id, data.phone);

        // save to user_interests
        for(let n = 0; n < data.interests.length; ++n)
        {
            await this.db.query(
                'INSERT INTO user_interests SET ?',
                {user_id, sp_type: data.interests[n], level: data.level[n]}
            )
        }

        // save mainArea
        let mainCity = (await this.getDistrictInfo(data.mainArea)).city_id;
        await this.db.query(
            'INSERT INTO user_living_cities SET ?',
            {user_id: user_id, city_id: mainCity, district_id: data.mainArea}
        )

        // save secondaryArea
        if(data.secondaryArea)
        {
            let secondaryCity = (await this.getDistrictInfo(data.secondaryArea)).city_id;
            await this.db.query(
                'INSERT INTO user_living_cities SET ?',
                {user_id: user_id, city_id: secondaryCity, district_id: data.secondaryArea}
            )
        }

        // save time habit
        for(let n = 0; n < data.regularTime.length; ++n)
        {
            await this.db.query(
                'INSERT INTO user_time_habit SET ?',
                {user_id: user_id, time_slot_id: data.regularTime[n]}
            )
        }

        // save difficulties
        for(let n = 0; n < data.difficulties.length; ++n)
        {
            await this.db.query(
                'INSERT INTO user_obstacles SET ?',
                {user_id: user_id, obstacle_id: data.difficulties[n]}
            )
        }

        // save other difficulties
        if(data.other !== '')
        {
            await this.db.query(
                'INSERT INTO user_obstacles_other SET ?',
                {user_id: user_id, comment: data.other}
            )
        }

        // set user as profileCompleted
        await this.db.query(
            'UPDATE users SET profile_completed = ? WHERE id = ?',
            [true, user_id]
        )
    }

    async getUserNickname(user_id)
    {
        let nickname = await this.db.query(
            'SELECT nickname FROM user_details WHERE user_id = ?',
            user_id,
         );
         return (nickname.length)? nickname[0].nickname : null;
    }

    async getUserDetail(user_id)
    {
        let columns = ['nickname', 'gender', 'birthday']
        let results = await this.db.query(
            'SELECT ?? FROM user_details WHERE user_id = ?',
            [columns, user_id]
        )
        let interests = await this.db.query(
            'SELECT sp_type, sp_name, level FROM user_interests_VIEW WHERE user_id = ?',
            user_id
        )
        let cities = await this.db.query(
            'SELECT c_name, d_name FROM user_living_cities_VIEW WHERE user_id = ?',
            user_id
        )
        let habit = await this.db.query(
            'SELECT time FROM user_time_habit_VIEW WHERE user_id = ?',
            user_id
        );
        let created_at = await this.db.query(
            'SELECT created_at FROM users WHERE id = ?',
            user_id
        )
        results[0].created_at = created_at[0].created_at;
        results[0].interests = interests;
        results[0].cities = cities;
        results[0].habit = [];
        for(let n = 0; n < habit.length; ++n)
        {
            results[0].habit.push(habit[n].time);
        }
        results[0].gender = (results[0].gender === 1)? '男性' : '女性'
        return results[0];
    }

    /* ----- Start of functions for QA ----- */
    /**
     *
     * @param {number} user_id
     * @param {number} sp_type
     * @param {string} q_title
     * @param {string} q_content
     *
     */
    async addQuestion(user_id, sp_type, q_title, q_content) {
        await this.db.query(
            'INSERT INTO QA_question SET ?',
            { user_id: user_id, sp_type: sp_type, q_title: q_title, q_content: q_content, timestamp: Date.now() },
        );
    }

    async getQuestionById(q_id) {
        let result = await this.db.query(
            'SELECT * FROM QA_question WHERE q_id = ?',
            q_id,
        )
        if(result.length)
        {
            let nickname = await this.getUserNickname(result[0].user_id);
            result[0].nickname = (nickname)? nickname: "User"+result[0].nickname;
        }
        return result;
    }

    async getAnswerById(a_id) {
        let result = await this.db.query(
            'SELECT * FROM QA_answer WHERE a_id = ?',
            a_id,
        )
        return result;
    }

    /**
     *
     * @param {number} user_id
     * @param {number} q_id
     * @param {string} a_content
     *
     */
    async addAnswer(user_id, q_id, a_content) {
        await this.db.query(
            'INSERT INTO QA_answer SET ?',
            { user_id: user_id, q_id: q_id, a_content: a_content, timestamp: Date.now() },
        );
    }

    /**
     * @param {number} sp_type
     */
    async getQuestions(sp_type) {
        let results =
            (!sp_type) ? await this.db.query(
                'SELECT * FROM QA_question ORDER BY `QA_question`.`timestamp` DESC'
            ) : await this.db.query(
                'SELECT * FROM QA_question WHERE sp_type = ? ORDER BY `QA_question`.`timestamp` DESC',
                sp_type
            );
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].user_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].user_id;
        }
        return results;
    }

    /**
     * @param {number} q_id
     */
    async getAnswers(q_id) {
        let results = await this.db.query(
            'SELECT * FROM QA_answer WHERE q_id = ? ORDER BY `QA_answer`.`timestamp` ASC',
            q_id
        )
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].user_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].user_id;
        }
        return results;
    }

    async editQuestion(q_id, sp_type, q_title, q_content) {
        await this.db.query(
            'UPDATE QA_question SET ? WHERE q_id = ?',
            [{ sp_type: sp_type, q_title: q_title, q_content: q_content, last_edit: Date.now() }, q_id]
        )
    }

    async editAnswer(a_id, a_content) {
        await this.db.query(
            'UPDATE QA_answer SET ? WHERE a_id = ?',
            [{ a_content: a_content, last_edit: Date.now() }, a_id]
        )
    }

    async deleteQuestionById(q_id) {
        await this.db.query(
            'DELETE FROM `QA_question` WHERE `q_id` = ?',
            q_id
        )
        await this.db.query(
            'DELETE FROM `QA_answer` WHERE `q_id` = ?',
            q_id
        )
    }

    async deleteAnswerById(a_id) {
        await this.db.query(
            'DELETE FROM `QA_answer` WHERE `a_id` = ?',
            a_id
        )
    }
    /* ----- End of functions for QA ----- */

    /* ----- Start of functions for Contest ----- */
    async addContest(User_id, Name, Organizer, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other) {
        await this.db.query(
            'INSERT INTO Contest SET ?',
            { User_id: User_id, Organizer: Organizer, Name: Name, Content: Content, Place: Place, sp_type: sp_type, StartDate: StartDate, EndDate: EndDate, Deadline: Deadline, Url: Url, Other: Other },
        );
    }

    async getContest() {
        let results = await this.db.query(
            'SELECT * FROM Contest'
        );

        return results;
    }

    async getOrderedContest() {
        let results = await this.db.query(
            'SELECT * FROM Contest ORDER by Deadline'
        );
        return results;
    }

    async getSelectType(sp_type) {
        let results = {};
        await this.db.query(
            'UPDATE `Contest` SET expired = 1 WHERE Deadline < CURDATE()',
        );
        if (sp_type === 0) {
            results = await this.db.query(
                'SELECT * FROM Contest WHERE expired != ? ORDER by Deadline',
                1
            );
        }
        else {
            results = await this.db.query(
                'SELECT * FROM Contest WHERE sp_type = ? ORDER by Deadline',
                sp_type
            );
        }
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].User_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].User_id;
        }
        return results;
    }

    async editContest(c_id, Name, Organizer, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other) {
        await this.db.query(
            'UPDATE Contest SET ? WHERE c_id = ?',
            [{ Name: Name, Organizer: Organizer, Content: Content, Place: Place, sp_type: sp_type, StartDate: StartDate, EndDate: EndDate, Deadline: Deadline, Url: Url, Other: Other }, c_id]
        )
    }

    async getContestById(c_id) {
        let results = await this.db.query(
            'SELECT * FROM Contest WHERE c_id = ?',
            c_id,
        )
        if(results.length)
        {
            let nickname = await this.getUserNickname(results[0].User_id);
            results[0].nickname = (nickname)? nickname : "User"+results[0].User_id;
        }
        return results;
    }

    async deleteContent(c_id) {
        await this.db.query(
            'DELETE FROM `Contest` WHERE `c_id` = ?',
            c_id
        )
    }

    async getContestByp_id(p_id) {
        let results = await this.db.query(
            'SELECT * FROM `Contest` WHERE `Place` = ?',
            [p_id]
        )
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].User_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].User_id;
        }
        return results;
    }

    /* ----- End of functions for Contest ----- */

    /* ----- Start of functions for Invite ----- */
    async addInvite(User_id, Name, Place, sp_type, DateTime, Other) {
        let results = await this.db.query(
            'INSERT INTO invite SET ?',
            { User_id: User_id, Name: Name, Place: Place, sp_type: sp_type, DateTime: DateTime, Other: Other },
        );
        return results.insertId;
    }
    async getInvite() {
        let results = await this.db.query(
            'SELECT * FROM invite'
        );

        return results;
    }
    async getInviteType(sp_type, NowDateTime) {
        let results = [];
        await this.db.query(
            'UPDATE `invite` SET expired = 1 WHERE DateTime < ?',
            NowDateTime
        );

        if (sp_type === 0) {
            results = await this.db.query(
                'SELECT * FROM invite WHERE expired != ? ORDER by DateTime',
                1
            );
        }
        else {
            results = await this.db.query(
                'SELECT * FROM invite WHERE sp_type = ? ORDER by DateTime',
                sp_type
            );
        }
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].User_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].User_id;
        }
        return results;
    }

    async getInviteById(i_id) {
        let results = await this.db.query(
            'SELECT * FROM invite WHERE i_id = ?',
            i_id,
        )
        if(results.length)
        {
            let nickname = await this.getUserNickname(results[0].User_id);
            results[0].nickname = (nickname)? nickname : "User"+results[0].User_id;
        }
        return results;
    }

    async editInvite(i_id, Name, Place, sp_type, DateTime, Other) {
        await this.db.query(
            'UPDATE invite SET ? WHERE i_id = ?',
            [{ Name: Name, Place: Place, sp_type: sp_type, DateTime: DateTime, Other: Other }, i_id]
        )
    }

    async deleteInvite(i_id) {
        await this.db.query(
            'DELETE FROM `invite` WHERE `i_id` = ?',
            i_id
        )
    }

    async alreadySignedUp(user_id, i_id)
    {
        let results = await this.db.query(
            'SELECT * FROM `invite_public_signup` WHERE user_id = ? AND i_id = ?',
            [user_id, i_id]
        );

        if(!results.length) return 0;
        else if(results.length)
        {
            if(results[0].approved === 0)
            {
                return -1;
            }
            else return results[0].approved;
        }

        // Not signed up: 0
        // signed up but not yet accepted or got rejected: -1
        // signed up and got accepted: 1
    }

    async signupPublicInv(user_id, i_id) {
        await this.db.query(
            "INSERT INTO `invite_public_signup` SET ?",
            { i_id: i_id, user_id: user_id, timestamp: Date.now(), approved: 0 }
        )
    }

    async getSignupListById(i_id)
    {
        let results =  await this.db.query(
            "SELECT * FROM `invite_public_signup` WHERE i_id = ? AND approved != -1",
            i_id
        )
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].user_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].user_id;
        }
        return results;
    }

    async getInvitationByUser(user_id)
    {
        let Inv = await this.db.query(
            "SELECT * FROM `invite` WHERE User_id = ? order by DateTime DESC",
            user_id
        )
        for(let n = 0; n < Inv.length; ++n)
        {
            let signupList = await this.getSignupListById(Inv[n].i_id);
            Inv[n].signupCount = signupList.length;
        }
        return Inv;
    }

    async getInvitationByPlace(p_id)
    {
        let results = await this.db.query(
            "SELECT * FROM `invite` WHERE Place = ? order by DateTime",
            p_id
        )
        for(let n = 0; n < results.length; ++n)
        {
            let nickname = await this.getUserNickname(results[n].User_id);
            results[n].nickname = (nickname)? nickname : "User"+results[n].User_id;
        }
        return results;
    }

    async getSignupById(s_id)
    {
        return await this.db.query(
            'SELECT * FROM `invite_public_signup` WHERE s_id = ?',
            s_id
        )
    }

    async appoveSignup(s_id)
    {
        await this.db.query(
            'UPDATE `invite_public_signup` SET approved = 1 WHERE s_id = ?',
            s_id
        )
    }

    async disappoveSignup(s_id)
    {
        await this.db.query(
            'UPDATE `invite_public_signup` SET approved = -1 WHERE s_id = ?',
            s_id
        )
    }

    /* ----- End of functions for Invite ----- */

    /* -------- Map start form here -------- */
    async addMap(Name,Latitude, Longitude, City, Town, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone, Renew, User) {
        var date = new Date();
        const year = date.now.getFullYear();
        const month = String(date.now.getMonth() + 1).padStart(2, 0);
        const day = String(date.now.getDate()).padStart(2, 0);
        Renew = `${year}-${month}-${day}`;
        
        await this.db.query(
            'INSERT INTO Map SET ?',
            { Name,Latitude, Longitude, City, Town, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone, Rank:0,Renew, User},
        );
    }

    async getPositionById(id) {
        let result = await this.db.query(
            'SELECT * FROM MapView WHERE ID = ?',
            id,
        )
        let sports = await this.db.query(
            'SELECT sp_type, sp_name FROM map_sports_VIEW WHERE ID = ?',
            id
        )
        result[0].sports = sports;
        return result;
    }

    async getOpenTime(id){
        let result = await this.db.query(
            'SELECT * FROM map_opentime WHERE ID = ?',
            id,
        )
        return result;
    }

    async getIdByName(Name) {
        let result = await this.db.query(
            'SELECT * FROM MapView WHERE Name = ?',
            Name,
        )
        return result[0].ID;
    }


    async editMapInfo(ID, Name, Latitude, Longitude, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone) {
        var date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, 0);
        const day = String(date.getDate()).padStart(2, 0);
        var Renew = `${year}-${month}-${day}`;

        await this.db.query(
            'UPDATE Map SET ? WHERE ID = ?',
            [{ Name: Name, Latitude: Latitude, Longitude: Longitude, Address: Address,OpenTime:OpenTime,CloseTime:CloseTime, Price:Price,Parking:Parking,sp_type:sp_type,Url: Url, Phone: Phone, Renew: Renew }, ID]
        )
    }

    async addPositionRank(ID, Rank, User, map, Comment) {
        await this.db.query(
            'INSERT INTO rank SET ?',
            { ID, Rank, User, Comment }
        );

        let data = await this.db.query(
            'SELECT * FROM `rank` WHERE `ID` = ?',
            ID
        );
        let rank = 0;
        if (data.length) {
            for (let n = 0; n < data.length; n++)
                rank += data[n].Rank;
            rank /= data.length;
        }

        await this.db.query(
            'UPDATE Map SET ? WHERE ID = ?',
            [{ Rank: rank }, ID]
        )
    }

    async changePositionRank(ID, Rank, Comment, User) {
        await this.db.query(
            'UPDATE rank SET Rank= ?, Comment = ? WHERE ID = ? AND User = ?',
            [Rank, Comment, ID, User]
        );
        let data = await this.db.query(
            'SELECT * FROM `rank` WHERE `ID` = ?',
            ID
        );
        let rank = 0;
        if (data.length) {
            for (let n = 0; n < data.length; n++)
                rank += data[n].Rank;
            rank /= data.length;
        }

        await this.db.query(
            'UPDATE Map SET ? WHERE ID = ?',
            [{ Rank: rank }, ID]
        )
    }

    async numberOfRank(ID) {
        let result = await this.db.query(
            'SELECT COUNT( ID ) FROM rank WHERE ID = ?',
            ID
        );
        return result;
    }

    async deletePosition(ID, User) {
        await this.db.query(
            'DELETE FROM Map WHERE ID = ? AND User = ?',
            [ID, User]
        );
    }

    async deleteRank(ID, User) {
        await this.db.query(
            'DELETE FROM rank WHERE ID = ? AND User = ?',
            [ID, User]
        );
        let data = await this.db.query(
            'SELECT * FROM `rank` WHERE `ID` = ?',
            ID
        );

        let rank = 0;
        if (data.length) {
            for (let n = 0; n < data.length; n++)
                rank += data[n].Rank;
            rank /= data.length;
        }

        await this.db.query(
            'UPDATE Map SET ? WHERE ID = ?',
            [{ Rank: rank }, ID]
        )
    }

    async deleteAllRank(ID) {
        await this.db.query(
            'DELETE FROM rank WHERE ID = ?',
            ID
        );
    }

    async getphotoByphotoid(photoid) {
        let result = await this.db.query(
            'SELECT * FROM Photo WHERE photoid = ?',
            photoid,
        )
        return result;
    }

    async deletephotoByphotoid(photoid) {
        await this.db.query(
            'DELETE FROM `Photo` WHERE `photoid` = ?',
            photoid
        )
    }

    async getRankExistence(ID, User) {
        let Rank = await this.db.query(
            'SELECT * FROM `rank` WHERE ID = ? AND USER = ?',
            [ID, User]
        );
        //console.log(Rank);
        return (Rank.length) ? Rank : -1;
    }

    async getRankExistencebyID(ID) {
        let Rank = await this.db.query(
            'SELECT * FROM `rank` WHERE ID = ? ',
            ID
        );
        //console.log(Rank);
        return (Rank.length) ? Rank : -1;
    }

    async getRankInfo(ID, User) {
        let Rank = await this.db.query(
            'SELECT * FROM `rank` WHERE ID = ? AND USER = ?',
            [ID, User]
        );
        //console.log(Rank);
        return Rank;
    }

    async getPosInfo(ID) {
        let Rank = await this.db.query(
            'SELECT * FROM `rank` WHERE ID = ?',
            ID
        );
        //console.log(Rank);
        return Rank;
    }

    async getPhotoInfo(ID, User) {
        let Photo = await this.db.query(
            'SELECT * FROM `Photo` WHERE `ID` = ? AND `User` = ?',
            [ID, User]
        );
        return Photo;
    }

    async addPhoto(ID, User, PhotoID) {
        await this.db.query(
            'INSERT INTO `Photo` SET ?',
            { ID, User, PhotoID }
        );
    }

    async searchPlaceByName(keywords) {
        let columns = ['ID', 'Name', 'Address', 'Latitude', 'Longitude']
        keywords = '%' + keywords + '%'
        keywords = keywords.replace(' ', '%')
        console.log(keywords);
        let results = await this.db.query(
            "SELECT ?? FROM `MapView` where Name LIKE ?",
            [columns, keywords]
        );
        return results
    }

    async getAllPosition() {
        let result = await this.db.query(
            'SELECT * FROM MapView'
        )
        for(let n = 0; n < result.length; ++n)
        {
            let sports = await this.db.query(
                'SELECT sp_type, sp_name from map_sports_VIEW WHERE ID = ?',
                result[n].ID
            )
            let opentime = await this.db.query(
                'SELECT * FROM map_opentime WHERE ID = ?',
                result[n].ID
            )
            result[n].sports = sports;
            result[n].opentime = opentime[0];
        }
        return result;
    }

    async getDistrictsByCity(city_id)
    {
        let results = await this.db.query(
            'SELECT * FROM districts WHERE city_id = ?',
            city_id
        )
        return results;
    }

    async getCities()
    {
        let results = await this.db.query(
            'SELECT * FROM cities'
        )
        return results;
    }

    async getDistricts()
    {
        let results = await this.db.query(
            'SELECT * FROM districts'
        )
        return results;
    }

    async getDistrictInfo(d_id)
    {
        let results = await this.db.query(
            'SELECT * FROM districts WHERE d_id = ?',
            d_id
        )

        return results[0];
    }

    /* -------- Map end here -------- */

    // 查詢某 sp_type
    async getSportById(sp_type) {
        let result = await this.db.query(
            'SELECT * FROM `sports` WHERE sp_id = ?',
            sp_type
        )
        return result;
    }

    /* ------ Start of functions for Rule ------ */
    async newRule(user_id, sp_type, rules, fromVersion) {
        let latest = this.getLatestRule(sp_type);

    }

    async getLatestRule(sp_type) {
        let columns = ['sp_type', 'versionNum', 'approved', 'r_id'];
        let results = await this.db.query(
            'SELECT ?? FROM `rules` WHERE `sp_type` = ? ORDER BY `rules`.`versionNum` DESC',
            [columns, sp_type]
        )

        for (var a = 0; a < results.length; ++a) {
            if (results[a].approved >= -10) {
                let latest = await this.db.query(
                    'SELECT * FROM `rules` WHERE `r_id` = ?',
                    results[a].r_id
                )
                return latest[0];
            }
        }
        return null;
    }

    async getUserApprovalStatus(user_id, r_id) {
        let results = await this.db.query(
            'SELECT * FROM `rules_approval_user` WHERE r_id = ? AND user_id = ?',
            [r_id, user_id]
        )
        return results;
    }

    //TODO: get所有Version

    async getRuleApprovalCountById(r_id) {
        let results = await this.db.query(
            'SELECT approved, r_id from rules where r_id = ?',
            r_id
        );
        return results;
    }

    /**
     * @param {number} user_id
     * @param {number} approval
     * @param {number} r_id
     */
    async approveRuleById(user_id, approval, r_id) {
        let results = await this.getRuleApprovalCountById(r_id);

        let user_approved = await this.getUserApprovalStatus(user_id, r_id);

        if (!results.length /* r_id not found */) {
            return -1;
        }
        else if (user_approved.length /* User already approved or disapproved */) {
            if (user_approved[0].approval === approval /* same approval */) {
                return 1;
            }
            else /* Change approval */ {
                await this.db.query(
                    'UPDATE `rules_approval_user` SET approval = ? WHERE r_id = ? AND user_id = ?',
                    [approval, r_id, user_id]
                );

                let approved = results[0].approved;
                await this.db.query(
                    'UPDATE `rules` SET ? WHERE r_id = ?',
                    [{ approved: approved + 2 * approval }, r_id]
                );
            }
        }
        else /* User hasn't approve */ {
            await this.db.query(
                'INSERT INTO `rules_approval_user` SET ?',
                { user_id, r_id, approval, timestamp: Date.now() }
            );

            let approved = results[0].approved;
            await this.db.query(
                'UPDATE `rules` SET ? WHERE r_id = ?',
                [{ approved: approved + approval }, r_id]
            );
        }
        return 0;
    }
    /* ------ End of functions for Rules ------ */

    /* ------ <聊天> ----- */

    /**
     * @typedef Chat
     * @type {object}
     * @property {number} id
     * @property {string} name
     * @property {string} last_message_created_at
     * @property {string} last_message_sender_name
     * @property {number} last_message_type
     * @property {string} last_message_content 
     */

    /**
     * 取得使用者所有可存取的邀請，及邀請中最後一則訊息的相關資訊。
     * @param {number} userId
     * @returns {Promise<Chat[]>}
     */
    async getChats(userId) {
        return await this.db.query(
            `
            SELECT
                invite.i_id AS id,
                invite.Name AS name,
                last_message.created_at AS last_message_created_at,
                last_message_sender.nickname AS last_message_sender_name,
                last_message.type AS last_message_type,
                last_message.content AS last_message_content
            FROM invite
            LEFT JOIN
                (
                    SELECT m1.invite_id, m1.created_at, m1.from_user_id, m1.type, m1.content
                    FROM invite_messages m1
                    LEFT JOIN invite_messages m2 ON (m1.invite_id = m2.invite_id AND m1.created_at < m2.created_at)
                    WHERE m2.invite_id IS NULL
                    GROUP BY m1.invite_id
                ) last_message ON last_message.invite_id = invite.i_id
            LEFT JOIN
                (
                    SELECT user_id, nickname
                    FROM user_details
                ) last_message_sender ON last_message_sender.user_id = last_message.from_user_id
            WHERE invite.User_id = ?
            OR (
                invite.i_id in (
                    SELECT i_id
                    FROM invite_public_signup
                    WHERE user_id = ? AND approved = 1
                )
            )
            ORDER BY last_message_created_at DESC, id DESC
            `,
            [userId, userId],
        );
    }

    /**
     * 取得使用者所有可存取的邀請 ID。
     * @param {number} userId 
     * @returns {Promise<number[]>}
     */
    async getChatIds(userId) {
        let results = await this.db.query(
            `
            SELECT i_id AS id
            FROM invite
            WHERE invite.User_id = ?
            OR (
                invite.i_id in (
                    SELECT i_id
                    FROM invite_public_signup
                    WHERE user_id = ? AND approved = 1
                )
            )
            `,
            [userId, userId],
        );
        return results.map(res => res.id);
    }

    async getMessages(inviteId, sinceMessageId) {
        let results = await this.db.query(
            `
            SELECT m.id, m.from_user_id, m.created_at, m.type, m.content, ud.nickname
            FROM invite_messages m
            LEFT JOIN user_details ud ON ud.user_id = m.from_user_id
            WHERE m.invite_id = ? AND m.id > ?
            ORDER BY m.created_at, m.id
            `,
            [inviteId, sinceMessageId],
        );
        return results.map(({ id, from_user_id, created_at, type, content, nickname }) => ({
            id,
            from: {
                id: from_user_id,
                nickname,
            },
            createdAt: created_at,
            type,
            content,
        }));
    }

    /**
     * 
     * @param {number} inviteId 
     * @param {number} userId 
     * @param {number} type 
     * @param {string} content
     */
    async addMessage(inviteId, userId, type, content) {
        await this.db.query(
            `INSERT INTO invite_messages SET ?`,
            {
                invite_id: inviteId,
                from_user_id: userId,
                type,
                content,
                created_at: Date.now(),
            },
        );
    }

    /* ------ </聊天> ----- */
}
