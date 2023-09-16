const express = require('express');
const z = require('zod');
const uid = require('uid-safe');
const crypto = require('node:crypto');
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
const CreateEmailSessionRequest = z.object({
    body: z.object({
        email: z.string().email(),
        token: z.string(),
    }),
});
const ResetPasswordRequest = z.object({
    body: z.object({
        password: z.string().min(6, '密碼不可以少於 6 個字元'),
    })
});
const SignInRequest = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string(),
        recaptchaResponse: z.string(),
    }),
});

const saltPasswordDelimiter = '$';
/**
 * 
 * @param {crypto.BinaryLike} password 
 * @param {crypto.BinaryLike} salt 
 * @param {number} keylen 
 * @param {crypto.ScryptOptions} options 
 * @returns {Promise<Buffer>}
 */
function scrypt(password, salt, keylen, options = {}) {
    return new Promise((res, rej) => {
        crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
            if (err) {
                rej(err);
            } else {
                res(derivedKey);
            }
        });
    });
}
async function generateSaltPasswordCombination(password) {
    const salt = await uid(32);
    const buf = await scrypt(password, salt, 32);
    return salt + saltPasswordDelimiter + buf.toString('base64');
}
async function checkIfPasswordMatches(expectedSaltPasswordCombination, passwordToCheck) {
    let [salt, expectedPasswordHash] = expectedSaltPasswordCombination.split(saltPasswordDelimiter);
    const buf = await scrypt(passwordToCheck, salt, 32);
    return expectedPasswordHash === buf.toString('base64');
}

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
        res.status(429).end();
        return;
    }
    if (attemptsIn24h >= maxAttemptsIn5min) {
        const attemptsIn5min = await db.getSendVerificationEmailAttemptsSince(req.body.email, fiveMinsAgo);
        if (attemptsIn5min >= maxAttemptsIn5min) {
            res.status(429).end();
            return;
        }
    }
    const token = await uid(32);
    await db.withTransaction(async (tdb) => {
        await tdb.setEmailVerificationToken(req.body.email, token);
        await tdb.recordSendEmailVerificationAttempt(req.body.email);
    });
    res.status(200).end();
}));

const emailSessionMaxAgeMs = 1000 * 60 * 60;
const emailTokenMaxAgeMs = 1000 * 30 * 60;

const checkEmailSession = (req, res, next) => {
    if (!req.session.emailSession) {
        res.status(401).end();
        return;
    }
    let { createdAt } = req.session.emailSession;
    if (!createdAt || (Date.now() - createdAt) > emailSessionMaxAgeMs) {
        res.status(401).end();
        return;
    }
    next();
}

router.get('/flow/email/session', checkEmailSession, wrap(async (req, res) => {
    let { email, flow } = req.session.emailSession;
    res.send({
        email,
        flow,
    });
}));

router.post('/flow/email/session', validate(CreateEmailSessionRequest), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    let tokenInfo = await db.getEmailVerificationToken(req.body.email);
    let tokenAge = Date.now() - tokenInfo.created_at;
    if (!tokenInfo || !tokenInfo.created_at || tokenAge > emailTokenMaxAgeMs || tokenInfo.used_at) {
        res.status(403);
        if (!tokenInfo || !tokenInfo.created_at) {
            res.send({ error: 'invalidToken' });
        } else if (tokenAge > emailTokenMaxAgeMs) {
            res.send({ error: 'tokenExpired' });
        } else {
            res.send({ error: 'tokenUsed' });
        }
        return;
    }
    await db.markEmailVerificationTokenAsUsed(req.body.email);
    let flow = (await db.isEmailRegistered(req.body.email)) ? 'resetPassword' : 'register';
    req.session.emailSession = {
        createdAt: Date.now(),
        email: req.body.email,
        flow,
    };
    res.status(200).send({
        email: req.body.email,
        flow,
    });
}));

router.post('/flow/email/resetPassword', checkEmailSession, validate(ResetPasswordRequest), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    let isEmailRegistered = await db.isEmailRegistered(req.session.emailSession.email);
    let comb = await generateSaltPasswordCombination(req.body.password);
    if (isEmailRegistered) {
        await db.setUserPassword(req.session.emailSession.email, comb);
    } else {
        await db.addUser(req.session.emailSession.email, comb);
    }
    delete req.session.emailSession;
    res.status(200).end();
}));

function checkUserSession(req, res, next) {
    if (!req.session.user) {
        res.status(401).end();
        return;
    }
    next();
}

router.get('/status', checkUserSession, wrap(async (req, res) => {
    let { id } = req.session.user;
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    let { email, phone } = await db.getUser(id);
    res.send({
        id,
        email,
        phone,
        profileCompleted: false,
    });
}));

router.post('/signin', validate(SignInRequest), wrap(async (req, res) => {
    //TODO: check recaptchaResponse

    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user = await db.getUserByEmail(req.body.email);
    if (!user) {
        res.status(403).send({ error: 'userNotFound' });
        return;
    }
    let matches = await checkIfPasswordMatches(user.password, req.body.password);
    if (!matches) {
        res.status(403).send({ error: 'invalidCredentials' });
        return;
    }

    req.session.user = {
        id: user.id,
        profileCompleted: false,
    };
    res.send({
        id: user.id,
        email: user.email,
        phone: user.phone,
        profileCompleted: false,
    });
}));

router.post('/signout', wrap(async (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid');
    res.end();
}));

module.exports = router;
