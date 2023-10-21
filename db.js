const mysql = require('promise-mysql');

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
            charset: 'utf8mb4'
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
            'SELECT id, email, phone FROM users WHERE id = ?',
            id,
        );
        if (!results.length) return null;
        return results[0];
    }

    async getUserByEmail(email) {
        let results = await this.db.query(
            'SELECT id, email, phone, password FROM users WHERE email = ?',
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
        if (sp_type === 0) {
            results = await this.db.query(
                'SELECT * FROM Contest ORDER by Deadline',
            );
        }
        else {
            results = await this.db.query(
                'SELECT * FROM Contest WHERE sp_type = ? ORDER by Deadline',
                sp_type
            );
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

        return results;
    }

    async deleteContent(c_id) {
        await this.db.query(
            'DELETE FROM `Contest` WHERE `c_id` = ?',
            c_id
        )
    }

    async getContestByp_id(p_id) {
        let result = await this.db.query(
            'SELECT * FROM `Contest` WHERE `Place` = ?',
            [p_id]
        )
        return result;
    }

    /* ----- End of functions for Contest ----- */

    /* ----- Start of functions for Invite ----- */
    async addInvite(User_id, Name, Place, sp_type, DateTime, Other) {
        await this.db.query(
            'INSERT INTO invite SET ?',
            { User_id: User_id, Name: Name, Place: Place, sp_type: sp_type, DateTime: DateTime, Other: Other },
        );
    }
    async getInvite() {
        let results = await this.db.query(
            'SELECT * FROM invite'
        );

        return results;
    }
    async getInviteType(sp_type) {
        let results = [];
        if (sp_type === 0) {
            results = await this.db.query(
                'SELECT * FROM invite ORDER by DateTime',
            );
        }
        else {
            results = await this.db.query(
                'SELECT * FROM invite WHERE sp_type = ? ORDER by DateTime',
                sp_type
            );
        }
        return results;
    }
    async getInviteById(i_id) {
        let results = await this.db.query(
            'SELECT * FROM invite WHERE i_id = ?',
            i_id,
        )

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
    /* ----- End of functions for Invite ----- */

    /* -------- Map start form here -------- */
    async addMap(Name, Latitude, Longitude, City, Town, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone, Renew, User) {
        var date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, 0);
        const day = String(date.getDate()).padStart(2, 0);
        Renew = `${year}-${month}-${day}`;

        await this.db.query(
            'INSERT INTO Map SET ?',
            { Name, Latitude, Longitude, City, Town, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone, Renew, User},
        );
    }

    async getPositionById(id) {
        let result = await this.db.query(
            'SELECT * FROM Map WHERE ID = ?',
            id,
        )
        return result;
    }

    async getIdByName(Name) {
        let result = await this.db.query(
            'SELECT * FROM Map WHERE Name = ?',
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

    async addPositionRank(ID, Rank, User, map) {
        await this.db.query(
            'INSERT INTO rank SET ?',
            { ID, Rank, User }
        );

        let data = await this.db.query(
            'SELECT * FROM `Rank` WHERE `ID` = ?',
            ID
        );
        let rank = 0;
        for (let n = 0; n < data.length; n++)
            rank += data[n].Rank;
        rank /= data.length;

        await this.db.query(
            'UPDATE MAP SET ? WHERE ID = ?',
            [{ Name: map[0].Name, Latitude: map[0].Latitude, Longitude: map[0].Longitude, Address: map[0].Address, Url: map[0].Url, Phone: map[0].Phone, Rank: rank, Renew: data[0].Renew }, ID]
        )
    }

    async changePositionRank(ID, Rank, User) {
        await this.db.query(
            'UPDATE rank SET Rank= ? WHERE ID = ? AND User = ?',
            [Rank, ID, User]
        );
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
            'DELETE FROM map WHERE ID = ? AND User = ?',
            [ID, User]
        );
    }

    async deleteRank(ID, User) {
        await this.db.query(
            'DELETE FROM rank WHERE ID = ? AND User = ?',
            [ID, User]
        );
    }

    async deleteAllRank(ID) {
        await this.db.query(
            'DELETE FROM rank WHERE ID = ?',
            ID
        );
    }

    async getphotoByphotoid(photoid) {
        let result = await this.db.query(
            'SELECT * FROM photo WHERE photoid = ?',
            photoid,
        )
        return result;
    }

    async deletephotoByphotoid(photoid) {
        await this.db.query(
            'DELETE FROM `photo` WHERE `photoid` = ?',
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

    async getPhotoInfo(ID, User) {
        let Photo = await this.db.query(
            'SELECT * FROM `photo` WHERE `ID` = ? AND `User` = ?',
            [ID, User]
        );
        return Photo;
    }

    async addPhoto(ID, User, PhotoID) {
        await this.db.query(
            'INSERT INTO `photo` SET ?',
            { ID, User, PhotoID }
        );
    }

    async searchPlaceByName(keywords) {
        let columns = ['ID', 'Name', 'Address', 'Latitude', 'Longitude']
        keywords = '%' + keywords + '%'
        keywords = keywords.replace(' ', '%')
        console.log(keywords);
        let results = await this.db.query(
            "SELECT ?? FROM `Map` where Name LIKE ?",
            [columns, keywords]
        );
        return results
    }

    async getAllPosition(){
        let result = await this.db.query(
            'SELECT * FROM Map WHERE 1'
        )
        return result;
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
}
