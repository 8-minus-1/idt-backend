const express = require('express');
const z = require('zod');
const uid = require('uid-safe');
const { validate, wrap } = require('../utils');
const DB = require('../db');

const LocateAccountRequest = z.object({
    body: z.object({
        email: z.string().email(),
    }),
});
const SendVerificationEmailRequest = z.object({
    body: z.object({
        email: z.string().email(),
        recaptchaResponse: z.string(),
    }),
});

const router = express.Router();

// TODO: router.use(XSRF Header)

router.post('/locateAccount', validate(LocateAccountRequest), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    let emailRegistered = await db.isEmailRegistered(req.body.email);
    res.send({ emailRegistered });
}));

router.post('/flow/email', validate(SendVerificationEmailRequest), wrap(async (req, res) => {
    //TODO: 檢查 recaptchaResponse

    /**
         * @type {DB}
         */
    const db = req.app.locals.db;
    const twentyFourHoursAgo = Date.now() - 86400 * 1000;
    const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
    const maxAttemptsIn24h = 10;
    const maxAttemptsIn5min = 5;
    const attemptsIn24h = await db.getSendVerificationEmailAttemptsSince(req.body.email, twentyFourHoursAgo);
    if (attemptsIn24h >= maxAttemptsIn24h) {
        res.sendStatus(429);
        return;
    }
    if (attemptsIn24h >= maxAttemptsIn5min) {
        const attemptsIn5min = await db.getSendVerificationEmailAttemptsSince(req.body.email, fiveMinsAgo);
        if (attemptsIn5min >= maxAttemptsIn5min) {
            res.sendStatus(429);
            return;
        }
    }
    const token = await uid(32);
    await db.withTransaction(async (tdb) => {
        await tdb.setEmailVerificationToken(req.body.email, token);
        await tdb.recordSendEmailVerificationAttempt(req.body.email);
    });
    res.sendStatus(200);
}));

module.exports = router;
