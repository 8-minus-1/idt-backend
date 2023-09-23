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

const addPositionRank = z.object({
    body: z.object({
        Name: z.string(),
        Rank: z.number(),
    }),
});

const getPosition = z.object({
    body: z.object({
        Name: z.string()
    }),
});

const router = express.Router();

router.post('/addPosition', auth.checkUserSession, validate(addPosition), wrap(async (req, res) => {
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
    const length = db.getPositionByName(Name).length;
    if (!length) {
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
    else {
        res.status(501).send({ error: "已存在相同地點!!" })
    }
}));

router.get('/getInfo', validate(getPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const Name = req.query.Name;

    let info = await db.getPositionByName(Name);
    let len = info.length;
    if (len) {
        res.send(info);
    }
    else {
        res.status(404).send({ error: "查無此地點!!" })
    }
}));

router.post('/addRank', auth.checkUserSession, validate(addPositionRank), wrap(async (req, res) => {
    /**
     * @type{DB}
     */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const Name = req.body.Name;
    const json = await db.getPositionByName(Name);
    const ID = json[0]["ID"];

    let Rank = await db.getUserRankPos(User, ID);

    if (Rank > 0) {
        Rank = req.body.Rank;
        await db.changePositionRank(ID, Rank, User);
        res.send({
            ID: ID,
            Rank: Rank,
            User: User
        });
    }
    else {
        Rank = req.body.Rank;
        await db.addPositionRank(ID, Rank, User);
        res.send({
            ID: ID,
            Rank: Rank,
            User: User
        });
    }
}));

// edit Map info
router.put('/emi',auth.checkUserSession,validate(addPosition),wrap(async(req,res) => {
    /**
     * @type {DB}
     */

    const db = req.app.locals.db;
    const Name = req.body.Name;
    const Latitude = req.body.Latitude;
    const Longitude = req.body.Longitude;
    const Address = req.body.Address;
    const Url = req.body.Address;
    const Phone = req.body.Phone;
    //const Renew = req.body.Date;
    const User = req.session.user.id;
    
    let mapobj = await db.getPositionByName(Name);
    if(!mapobj.length) {
        res.status(404).send({error:"Unsuccessful enquiry"});
    }
    else if(mapobj[0].User !== User){
        res.status(403).send({error:"permission denied"});
    }
    else{
        await db.editMapInfo(Name, Latitude, Longitude, Address,Url, Phone, User);
        res.send({
            status : "Done",
            ID : ID,
            Name : Name,
            User : User
        });
    }
}))

module.exports = router;
