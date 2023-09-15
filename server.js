const express = require('express');
const morgan = require('morgan');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const z = require('zod');
const rfs = require('rotating-file-stream');
const fs = require('node:fs/promises');
const path = require('node:path');
if (!require('node:fs').existsSync('./config.json')) {
    console.error('請先建立 config.json！');
    return;
}
const rawConfig = require('./config.json');

const Config = z.object({
    sessionSecret: z.string(),
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
    } else {
        app.use(morgan('common'));
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
    app.get('/', (req, res) => {
        res.send('hello');
    });
    app.use('/cats', require('./routes/cats.js'));

    app.use((err, req, res, next) => {
        req.error = err;
        next(err);
    });
    app.listen(4000, () => {
        console.log('Server started');
    });
}

main();
