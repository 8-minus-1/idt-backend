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
        Renew: z.coerce.date(),
        User: z.string()
    }),
});

const addRank = z.object({
    
});

const getPosition = z.object({
    query: z.object({
        Name: z.string()
    }),
});



const router = express.Router();

router.post('/', auth.checkUserSession, validate(addPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const Name = req.body.Name;
    const Longitude = req.body.Longitude;
    const Latitude = req.body.Latitude;
    const Address = req.body.Address;
    const Url = req.body.Address;
    const Phone = req.body.Phone;
    const Renew = req.body.Date;
    const User = req.session.user.id;

    if(!getPositionByName(Name))
    {
        await db.addMap(Name, Latitude, Longitude, Address, Url, Phone, Renew, User);
        res.send({
            status: "OK",
            Name: Name,
            Latitude: Latitude,
            Longitude: Longitude,
            Address: Address,
            Url: Url,
            Phone: Phone,
            Renew: Renew,
            User: User
        });
    }
    else
    {
        res.status(501).send({error: "已存在相同地點!!"})
    }
}));

router.get('/', validate(getPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const Name = req.query.Name;

    let info = await db.getPositionByName(Name);
    let len = info.length;
    if(len)
    {
        res.send(info);
    }
    else
    {
        res.status(404).send({error: "查無此地點!!"})
    }
}));


module.exports = router;
