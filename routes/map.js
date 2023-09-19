const express = require('express');
const z = require('zod');
const uid = require('uid-safe');
const crypto = require('node:crypto');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');
const app = express();

const addPosition = z.object({
    body: z.object({
        Name: z.string().max(30),
        Latitude: z.number(),
        Longitude: z.number(),
        Address: z.string(),
        Url: z.string(),
        Phone: z.string(),
        //Rank: z.number().max(5).min(1),
        Renew: z.coerce.date(),
        User: z.string()
    }),
});

const router = express.Router();

router.post('/', auth.checkUserSession, validate(addPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    // const user_id = req.session.user.id;
    // const sp_type = req.body.sp_type;
    // const q_title = req.body.q_title;
    // const q_content = req.body.q_content;

    const Name = req.body.Name;
    const Longitude = req.body.Longitude;
    const Latitude = req.body.Latitude;
    const Address = req.body.Address;
    const Url = req.body.Address;
    const Phone = req.body.Phone;
    const Renew = req.body.Date;
    const User = req.session.user.id;

    await db.addMap(Name, Latitude, Longitude, Address, Url, Phone, Renew, User);
    res.send({
        status: "OK",
        // user: user_id,
        // q_title: q_title,
        // q_content: q_content

        Name: Name,
        Latitude: Latitude,
        Longitude: Longitude,
        Address: Address,
        Url: Url,
        Phone: Phone,
        //Rank: Rank,
        Renew: Renew,
        User: User
    });
}));

module.exports = router;
