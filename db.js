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
            charset: 'utf8mb4',
        });
        return new DB(pool);
    }

    /**
     * @param {mysql.Pool} pool 
     */
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * @param {string} email 
     * @returns {Promise<boolean>}
     */
    async isEmailRegistered(email) {
        const results = await this.pool.query(
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
        await this.pool.query(
            'REPLACE INTO email_verification_codes SET ?',
            fields,
        );
    }

    async getEmailVerificationToken(email) {
        let columns = ['email', 'token', 'created_at', 'used_at'];
        let results = await this.pool.query(
            'SELECT ?? FROM email_verification_codes WHERE email = ?',
            [columns, email],
        );
        if (!results.length) return null;
        return results[0];
    }

    async markEmailVerificationTokenAsUsed(email) {
        await this.pool.query(
            'UPDATE email_verification_codes SET ? WHERE email = ?',
            [{ used_at: Date.now() }, email],
        );
    }

    /**
     * 
     * @param {string} email 
     * @param {number} when 
     * @returns {number} Number of attempts
     */
    async getSendVerificationEmailAttemptsSince(email, when) {
        let results = await this.pool.query(
            'SELECT COUNT(*) as count FROM send_verification_email_attempts WHERE email = ? AND created_at > ?',
            [email, when],
        );
        return results[0].count;
    }

    async recordSendEmailVerificationAttempt(email) {
        await this.pool.query(
            'INSERT INTO send_verification_email_attempts SET ?',
            { email, created_at: Date.now() },
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
        await this.pool.query(
            'INSERT INTO QA_question SET ?',
            { user_id: user_id, sp_type: sp_type, q_title: q_title, q_content: q_content, timestamp: Date.now() },
        );
    }
    /* ----- End of functions for QA ----- */
}
