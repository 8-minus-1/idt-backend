const express = require('express');
const morgan = require('morgan'); // HTTP Request logger
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const z = require('zod');
const rfs = require('rotating-file-stream');
const cors = require('cors');
const fs = require('node:fs/promises');
const path = require('node:path');

if (!require('node:fs').existsSync('./config.json')) {
    console.error('請先建立 config.json！');
    return;
}
const rawConfig = require('./config.json');
const DB = require('./db');

const Config = z.object({
    sessionSecret: z.string(),
    mysql: z.object({
        host: z.string(),
        port: z.number(),
        user: z.string(),
        password: z.string(),
        dbname: z.string(),
    }),
    email: z.object({
        api: z.object({
            url: z.string().url(),
            token: z.string(),
        }).optional(),
        fromName: z.string(),
        fromAddress: z.string().email(),
        verificationUrlTemplate: z.string()
            .refine((str) => ['email', 'token', 'flow']
                .every(placeholder => str.includes(`{${placeholder}}`))
            ),
        registrationSubject: z.string(),
        resetPasswordSubject: z.string(),
    }).optional(),
    smsService: z.object({
        user: z.string(),
        password: z.string(),
    }).optional(),
    verificationTestingReceiverCredentials: z.object({
        telegramChatId: z.string(),
        telegramBotToken: z.string(),
    }).optional(),
    recaptchaSecret: z.string().optional(),
});
const config = Config.parse(rawConfig);

morgan.token('error', (req, res) => {
    if (!req.error) {
        return '';
    }
    return '\n' + req.error.stack;
});

function isJsonParsingError(error) {
    return error && error.stack && error.stack.includes('at JSON.parse') && error.stack.includes('body-parser');
}

async function main() {
    const sessionsPath = path.join('data', 'sessions');
    const logsPath = path.join('data', 'logs');
    await fs.mkdir(sessionsPath, { recursive: true });
    await fs.mkdir(logsPath, { recursive: true });

    const app = express();

    const logStream = rfs.createStream(path.join(logsPath, 'app.log'), {
        size: '10M',
        compress: 'gzip',
    });
    const errorLogStream = rfs.createStream(path.join(logsPath, 'error.log'), {
        size: '10M',
        compress: 'gzip',
    });
    app.use(morgan('combined', {
        stream: logStream,
    }));
    app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent":error', {
        stream: errorLogStream,
        skip: (req, res) => !req.error || isJsonParsingError(req.error),
    }));
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 'loopback');
        app.locals.isDev = false;
        if (!config.recaptchaSecret) {
            console.error('請填入 reCAPTCHA secret');
            process.exit(1);
        }
    } else {
        app.use(morgan('common'))
        app.locals.isDev = true;
    }
    app.use(session({
        store: new FileStore({
            path: sessionsPath,
        }),
        secret: config.sessionSecret,
        cookie: {
            maxAge: 1000 * 86400 * 21,
        },
        resave: false,
        saveUninitialized: false,
    }));
    app.use(express.json());
    const db = await DB.create({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        dbname: config.mysql.dbname,
    });
    app.locals.db = db;
    app.locals.config = config;

    const corsOptions = {};
    if (app.locals.isDev) {
        corsOptions.origin = 'http://localhost:3000'
        corsOptions.credentials = true;
    }
    app.use(cors(corsOptions));

    app.get('/', (req, res) => {
        res.send('hello');
    });

    app.use('/cats', require('./routes/cats.js'));
    app.use('/api/auth', require('./routes/auth.js').router);
    app.use('/api/qa', require('./routes/qa.js'));
    app.use('/api/cont', require('./routes/contest.js'));
    app.use('/api/invite', require('./routes/invite.js'));
    app.use('/api/map', require('./routes/map.js'));
    app.use('/api/rules' ,require('./routes/rules'));
    app.use('/api/chats', require('./routes/chats'));

    app.use((err, req, res, next) => {
        req.error = err;
        next(err);
    });
    app.listen(4000, () => {
        console.log('Server started');
    });
}

main();
