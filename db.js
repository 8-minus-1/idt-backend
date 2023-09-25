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

    async deleteAnswerById(a_id)
    {
        await this.db.query(
            'DELETE FROM `QA_answer` WHERE `a_id` = ?',
            a_id
        )
    }
    /* ----- End of functions for QA ----- */

    /* ----- Start of functions for Contest ----- */
    async addContest(User_id, Name, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other) {
        await this.db.query(
            'INSERT INTO Contest SET ?',
            { User_id: User_id, Name: Name, Content: Content, Place: Place, sp_type: sp_type, StartDate: StartDate, EndDate: EndDate, Deadline: Deadline, Url: Url, Other: Other },
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
        let results = await this.db.query(
            'SELECT * FROM Contest WHERE sp_type = ? ORDER by Deadline',
            sp_type
        );
        return results;
    }
    
    async editContest(c_id, Name, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other) {
        await this.db.query(
            'UPDATE Contest SET ? WHERE c_id = ?',
            [{ Name:Name, Content:Content, Place:Place, sp_type:sp_type, StartDate:StartDate, EndDate:EndDate, Deadline:Deadline, Url:Url, Other:Other }, c_id]
        )
    }

    async getContestById(c_id) {
        let results = await this.db.query(
            'SELECT * FROM Contest WHERE c_id = ?',
            c_id,
        )

        return results;
    }

    async deleteContent(c_id)
    {
        await this.db.query(
            'DELETE FROM `Contest` WHERE `c_id` = ?',
            c_id
        )
    }
    /* ----- End of functions for Contest ----- */

    /* -------- Map start form here -------- */
    async addMap(Name, Latitude, Longitude, Address, Url, Phone, Renew, User) {
        await this.db.query(
            'INSERT INTO Map SET ?',
            { Name, Latitude, Longitude, Address, Url, Phone, Renew: Date.now(), User },
        );
    }

    async getPositionByName(Name) {
        let result = await this.db.query(
            'SELECT * FROM Map WHERE Name = ?',
            Name,
        )
        return result;
    }

    /**/
    async editMapInfo(ID, Name, Latitude, Longitude, Address,Url, Phone, User) {
        await this.db.query(
            'UPDATE Map SET ? WHERE ID = ?',
            [{ Name : Name, Latitude : Latitude, Longitude : Longitude, Address : Address, Url : Url,Phone : Phone, Renew : Date.now(), User : User }, ID]
        )
    }
    
    async addPositionRank(ID, Rank, User){
        await this.db.query(
            'INSERT INTO rank SET ?',
            { ID, Rank, User }
        );
    }
    async changePositionRank(ID, Rank, User){
        await this.db.query(
            'UPDATE rank SET Rank= ? WHERE ID = ? AND User = ?',
            { Rank }, ID, User,
        );
    }
    /* -------- Map end here -------- */

    // 查詢某 sp_type
    async getSportById(sp_type)
    {
        let result = await this.db.query(
            'SELECT * FROM `sports` WHERE sp_id = ?',
            sp_type
        )
        return result;
    }

    /* ------ Start of functions for Rule ------ */
    async newRule(user_id, sp_type, rules, fromVersion)
    {
        let latest = this.getLatestRule(sp_type);

    }

    async getLatestRule(sp_type)
    {
        let columns = ['sp_type', 'versionNum','approved', 'r_id'];
        let results = await this.db.query(
            'SELECT ?? FROM `rules` WHERE `sp_type` = ? ORDER BY `rules`.`versionNum` DESC',
            [columns, sp_type]
        )

        for(var a = 0; a < results.length; ++a)
        {
            if(results[a].approved >= -10)
            {
                let latest = await this.db.query(
                    'SELECT * FROM `rules` WHERE `r_id` = ?',
                    results[a].r_id
                )
                return latest[0];
            }
        }
        return null;
    }

    async getUserApprovalStatus(user_id, r_id)
    {
        let results = await this.db.query(
            'SELECT * FROM `rules_approval_user` WHERE r_id = ? AND user_id = ?',
            [r_id, user_id]
        )
        return results;
    }

    //TODO: get所有Version

    async getRuleApprovalCountById(r_id)
    {
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
    async approveRuleById(user_id, approval, r_id)
    {
        let results = await this.getRuleApprovalCountById(r_id);

        let user_approved = await this.getUserApprovalStatus(user_id, r_id);

        if(!results.length /* r_id not found */)
        {
            return -1;
        }
        else if(user_approved.length /* User already approved or disapproved */)
        {
            if(user_approved[0].approval === approval /* same approval */)
            {
                return 1;
            }
            else /* Change approval */
            {
                await this.db.query(
                    'UPDATE `rules_approval_user` SET approval = ? WHERE r_id = ? AND user_id = ?',
                    [approval, r_id, user_id]
                );

                let approved = results[0].approved;
                await this.db.query(
                    'UPDATE `rules` SET ? WHERE r_id = ?',
                    [{approved: approved + 2 * approval}, r_id]
                );
            }
        }
        else /* User hasn't approve */
        {
            await this.db.query(
                'INSERT INTO `rules_approval_user` SET ?',
                {user_id, r_id, approval, timestamp: Date.now()}
            );

            let approved = results[0].approved;
            await this.db.query(
                'UPDATE `rules` SET ? WHERE r_id = ?',
                [{approved: approved + approval}, r_id]
            );
        }
        return 0;
    }
    /* ------ End of functions for Rules ------ */
}
