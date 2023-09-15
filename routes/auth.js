const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');

const LocateAccountRequest = z.object({
    body: z.object({
        email: z.string().email(),
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

module.exports = router;
