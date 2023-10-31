const express = require('express');
const z = require('zod');
const uid = require('uid-safe');
const Got = import('got');
const rand = require('csprng');
const crypto = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
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
const SendPhoneCodeRequest = z.object({
    body: z.object({
        phone: z.string().regex(/^09\d{8}$/),
        recaptchaResponse: z.string(),
    }),
});
const PresentCodeRequest = z.object({
    body: z.object({
        code: z.string().regex(/^\d{6}$/)
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

async function sendVerificationEmail(isDev, config, toAddress, token, isResetPassword) {
    let basicEmailConfigSetUp = !!config.email;
    let emailApiSetUp = basicEmailConfigSetUp && !!config.email.api;
    let testingReceiverSetUp = !!config.verificationTestingReceiverCredentials?.telegramChatId;
    let shouldUseApi = !isDev && emailApiSetUp;
    let shouldUseTestingReceiver = isDev && testingReceiverSetUp;
    if (!basicEmailConfigSetUp || (!shouldUseApi && !shouldUseTestingReceiver)) {
        console.log('Skipping sending email');
        return;
    }
    let templateFileName = isResetPassword ? 'reset-password-email.txt' : 'registration-email.txt';
    let template = await readFile(path.join(__dirname, '..', 'templates', templateFileName), 'utf-8');
    let flow = isResetPassword ? 'resetPassword' : 'register';
    let targetUrl = config.email.verificationUrlTemplate
        .replaceAll('{email}', encodeURIComponent(toAddress))
        .replaceAll('{token}', encodeURIComponent(token))
        .replaceAll('{flow}', encodeURIComponent(flow));
    let subject = isResetPassword ? config.email.resetPasswordSubject : config.email.registrationSubject;
    let content = template.replaceAll('{url}', targetUrl);
    let got = (await Got).default;
    if (shouldUseApi) {
        await got.post(config.email.api.url, {
            headers: {
                authorization: 'Bearer ' + config.email.api.token,
            },
            json: {
                fromAddress: config.email.fromAddress,
                fromName: config.email.fromName,
                toAddress: toAddress,
                subject: subject,
                content: [{
                    type: 'text/plain',
                    value: content,
                }],
            },
        });
    } else if (shouldUseTestingReceiver) {
        let message = `From: ${config.email.fromAddress}
To: ${toAddress}
Subject: ${subject}

${content.replaceAll('http', 'http')}`;
        let { telegramBotToken, telegramChatId } = config.verificationTestingReceiverCredentials;

        await got.post('https://api.telegram.org/bot' + telegramBotToken + '/sendMessage', {
            json: {
                chat_id: telegramChatId,
                text: message,
            },
        });
    }
}

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
        let { isDev, config } = req.app.locals;
        let isEmailRegistered = await db.isEmailRegistered(req.body.email);
        await sendVerificationEmail(isDev, config, req.body.email, token, isEmailRegistered);
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
    let { email, phone, profile_completed, nickname } = await db.getUser(id);
    res.send({
        id,
        email,
        phone,
        profileCompleted: !!profile_completed,
        nickname,
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
        profileCompleted: user.profile_completed,
    };
    res.send({
        id: user.id,
        email: user.email,
        phone: user.phone,
        profileCompleted: user.profile_completed,
    });
}));

router.post('/signout', wrap(async (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid');
    res.end();
}));

/**
 * 
 * @param {DB} db 
 * @param {number} userId 
 * @param {?string} phone
 * @param {{
 *  maxSendAttemptsInLast24h: number,
 *  maxSendAttemptsInLast3Min: number,
 *  maxPresentAttemptsInLast3Min: number
 * }} policy
 * @returns {Promise<{ nextCodePresentAt: number, nextSmsAvailableAt: number }>}
 */
async function getPhoneVerificationRateLimitDetails(db, userId, phone, policy) {
    const twentyFourHoursAgo = Date.now() - 86400 * 1000;
    const threeMinsAgo = Date.now() - 5 * 60 * 1000;

    const sendSmsAttemptsForUserOrPhoneIn24h = await db.getSendVerificationSmsAttemptsForUserOrPhoneSince(userId, phone, twentyFourHoursAgo);
    const sendSmsAttemptsForUserOrPhoneIn3Min = await db.getSendVerificationSmsAttemptsForUserOrPhoneSince(userId, phone, threeMinsAgo);
    const presentCodeAttemptsForUserIn3Min = await db.getPresentPhoneVerificationCodeAttemptsForUserSince(userId, threeMinsAgo);

    let nextSmsAvailableAt = 0;
    let nextCodePresentAt = 0;
    if (sendSmsAttemptsForUserOrPhoneIn24h.length >= policy.maxSendAttemptsInLast24h) {
        sendSmsAttemptsForUserOrPhoneIn24h.sort().reverse();
        const chosen = sendSmsAttemptsForUserOrPhoneIn24h[policy.maxSendAttemptsInLast24h - 1];
        nextSmsAvailableAt = Date.now() + (chosen - twentyFourHoursAgo);
    } else if (sendSmsAttemptsForUserOrPhoneIn3Min.length >= policy.maxSendAttemptsInLast3Min) {
        sendSmsAttemptsForUserOrPhoneIn3Min.sort().reverse();
        const chosen = sendSmsAttemptsForUserOrPhoneIn3Min[policy.maxSendAttemptsInLast3Min - 1];
        nextSmsAvailableAt = Date.now() + (chosen - threeMinsAgo);
    }
    if (presentCodeAttemptsForUserIn3Min.length >= policy.maxPresentAttemptsInLast3Min) {
        presentCodeAttemptsForUserIn3Min.sort().reverse();
        const chosen = presentCodeAttemptsForUserIn3Min[policy.maxPresentAttemptsInLast3Min - 1];
        nextCodePresentAt = Date.now() + (chosen - threeMinsAgo);
    }

    return {
        nextCodePresentAt,
        nextSmsAvailableAt,
    };
}

const phoneCodeMaxAge = 15 * 60 * 1000;
const maxPhoneCodeSendAttemptsInLast24h = 10;
const maxPhoneCodeSendAttemptsInLast3Min = 1;
const maxPhoneCodePresentAttemptsInLast3Min = 5;

router.get('/flow/phone', wrap(async (req, res) => {
    if (!req.session.user) {
        return res.status(401).end();
    }
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user = await db.getUser(req.session.user.id);
    if (user.phone) {
        return res.send({
            verified: true,
        });
    }

    const codeDetails = await db.getPhoneVerificationCodeForUser(user.id);
    const codeExpired = codeDetails && (Date.now() - codeDetails.created_at) > phoneCodeMaxAge;
    const phoneToCheck = codeExpired ? null : codeDetails?.phone;
    const { nextCodePresentAt, nextSmsAvailableAt } = await getPhoneVerificationRateLimitDetails(db, user.id, phoneToCheck, {
        maxPresentAttemptsInLast3Min: maxPhoneCodePresentAttemptsInLast3Min,
        maxSendAttemptsInLast24h: maxPhoneCodeSendAttemptsInLast24h,
        maxSendAttemptsInLast3Min: maxPhoneCodeSendAttemptsInLast3Min,
    });
    const response = {
        verified: false,
        nextCodePresentAt,
        nextSmsAvailableAt,
    };
    if (phoneToCheck) response.phone = phoneToCheck;
    res.send(response);
}));

async function sendVerificationSms(isDev, config, phone, code) {
    const shouldUseTestingReceiver = isDev && !!config.verificationTestingReceiverCredentials;
    const shouldUseApi = !isDev && !!config.smsService;

    if (!shouldUseApi && !shouldUseTestingReceiver) {
        console.log('Skipping sending sms');
        return;
    }
    let template = await readFile(path.join(__dirname, '..', 'templates', 'phone-verification-sms.txt'), 'utf-8');
    let content = template.replaceAll('{code}', code);
    if (shouldUseApi) {
        throw new Error('SMS service not implemented');
    } else if (shouldUseTestingReceiver) {
        let got = (await Got).default;
        let message = `To: ${phone}

${content}`;
        let { telegramBotToken, telegramChatId } = config.verificationTestingReceiverCredentials;
        await got.post('https://api.telegram.org/bot' + telegramBotToken + '/sendMessage', {
            json: {
                chat_id: telegramChatId,
                text: message,
            },
        });
    }
}

router.post('/flow/phone/send',
    (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).end();
        }
        next();
    },
    validate(SendPhoneCodeRequest),
    wrap(async (req, res) => {
        /**
         * @type {DB}
         */
        const db = req.app.locals.db;
        const user = await db.getUser(req.session.user.id);
        if (user.phone) {
            return res.status(403).send({
                error: 'alreadyVerified',
            });
        }

        //TODO: verify recaptchaResponse

        let phone = req.body.phone;
        if (await db.hasUserWithPhone(phone)) {
            return res.status(403).send({
                error: 'phoneOccupied'
            });
        }

        const { nextSmsAvailableAt } = await getPhoneVerificationRateLimitDetails(db, user.id, phone, {
            maxPresentAttemptsInLast3Min: maxPhoneCodePresentAttemptsInLast3Min,
            maxSendAttemptsInLast24h: maxPhoneCodeSendAttemptsInLast24h,
            maxSendAttemptsInLast3Min: maxPhoneCodeSendAttemptsInLast3Min,
        });
        if (nextSmsAvailableAt > Date.now()) {
            return res.status(429).end();
        }
        await db.withTransaction(async (db) => {
            let code = rand(32, 10).slice(0, 6);
            let { isDev, config } = req.app.locals;
            await db.setPhoneVerificationCode(user.id, code, phone);
            await sendVerificationSms(isDev, config, phone, code);
            await db.recordSendVerificationSmsAttempt(user.id, phone);
        });
        return res.end();
    }),
);

router.post(
    '/flow/phone/code',
    (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).end();
        }
        next();
    },
    validate(PresentCodeRequest),
    wrap(async (req, res) => {
        /**
         * @type {DB}
         */
        const db = req.app.locals.db;
        const user = await db.getUser(req.session.user.id);
        if (user.phone) {
            return res.status(403).send({
                error: 'alreadyVerified',
            });
        }

        const codeDetails = await db.getPhoneVerificationCodeForUser(user.id);
        if (!codeDetails) {
            return res.status(403).send({
                error: 'noCodeSentYet',
            });
        }
        if ((Date.now() - codeDetails.created_at) > phoneCodeMaxAge) {
            return res.status(403).send({
                error: 'codeExpired',
            });
        }
        const { nextCodePresentAt } = await getPhoneVerificationRateLimitDetails(db, user.id, null, {
            maxPresentAttemptsInLast3Min: maxPhoneCodePresentAttemptsInLast3Min,
            maxSendAttemptsInLast24h: maxPhoneCodeSendAttemptsInLast24h,
            maxSendAttemptsInLast3Min: maxPhoneCodeSendAttemptsInLast3Min,
        });
        if (nextCodePresentAt > Date.now()) {
            return res.status(429).end();
        }
        await db.withTransaction(async (db) => {
            await db.recordPresentPhoneVerificationCodeAttempt(user.id, codeDetails.phone);
            if (codeDetails.code === req.body.code) {
                await db.setUserPhone(user.id, codeDetails.phone);
                await db.markPhoneVerificationCodeAsUsed(user.id);
                return res.end();
            } else {
                return res.status(403).send({ error: 'invalidCode' });
            }
        });
    }),
);

const fakeSigninSchema = z.object({
    body: z.object({
        user_id: z.number()
    })
})

// 模擬登入行為, to test features that requires checking auth status, without creating a real account
// this function just simply create session to store a testing user_id
router.post('/fakeSignin', validate(fakeSigninSchema), wrap(async (req, res) => {
    const user_id = req.body.user_id;
    req.session.user = {
        id: user_id,
        profileCompleted: false,
    };
    res.send({
        message: "Fake signed in as user "+user_id+"!"
    });
}));

const surveySchema = z.object({
   body: z.object({
       name: z.string().min(1).max(32),
       phone: z.string().length(10),
       nickname: z.string().max(32).min(1),
       gender: z.coerce.number(),
       birthday: z.number(), //bigint
       height: z.coerce.number(),
       weight: z.coerce.number(),
       interests: z.array( z.coerce.number() ),
       avgHours: z.coerce.number().max(168),
       regularTime: z.array( z.coerce.number() ),
       level: z.array( z.coerce.number() ),
       mainArea: z.coerce.number().max(370),
       secondaryArea: z.coerce.number().max(370),
       difficulties: z.array( z.coerce.number().max(5) ),
       other: z.string().trim().max(64)
   })
});

router.post('/userSurvey', checkUserSession, validate(surveySchema), wrap( async (req, res)=>{
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const profileCompleted = req.session.user.profileCompleted;
    let data = req.body;
    //console.log(data);

    if(data.interests.length !== data.level.length)
    {
        res.status(400).send({error: "興趣與等級長度不符"})
    }
    if(profileCompleted)
    {
        res.status(409).send({error: "已有資料"})
    }
    else
    {
        await db.setUserProfile(user_id, data);
        res.send({status: "OK"});
    }
}))

router.get('/myInfo', checkUserSession, wrap( async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user = req.session.user;

    if(!user.profileCompleted)
    {
        res.status(404).send({error: "尚未填寫註冊問卷！"})
    }
    else
    {
        let user_detail = await db.getUserDetail(user.id);
        res.send(user_detail);
    }

}))

// exports the router and the checkUserSession function
// 在其他檔案也可以直接引入，以確定登入狀態
module.exports = {router, checkUserSession};
