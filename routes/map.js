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
        Phone: z.string()
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

const checkPosition = z.object({
    body: z.object({
        Name: z.string()
    })
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
    const User = req.session.user.id;

    let info = await db.getPositionByName(Name);
    let len = info.length;
    var Renew;

    if (!len) {
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
        res.status(404).send({ error: "查無此地點!!" });
    }
}));

router.post('/addRank', auth.checkUserSession, validate(addPositionRank), wrap(async (req, res) => {
    /**
     * @type{DB}
     */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const Name = req.body.Name;
    const Rank = req.body.Rank;

    let info = await db.getPositionByName(Name);
    let len = info.length;

    if (len) {
        const ID = info[0].ID;
        let exist = await db.getRankExistence(ID, User);
        if(exist === -1){
            await db.addPositionRank(ID, Rank, User);
            res.send({
                ID: ID,
                Rank: Rank,
                User: User
            });
        }
        else {
            res.status(405).send({ error: "已評價該地點!!" });
        }
    }
    else {
        res.status(404).send({ error: "無此地點!!" });
    }
}));

router.put('/editRank', auth.checkUserSession, validate(addPositionRank), wrap(async (req, res) => {
    /**
     * @type{DB}
     */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const Name = req.body.Name;
    const Rank = req.body.Rank;    

    let info = await db.getPositionByName(Name);
    let len = info.length;
    if (len) {
        const ID = info[0].ID;
        let exist = await db.getRankExistence(ID, User);
        if(exist===-1){
            res.status(403).send({error:"無此評分資訊"});
        }
        else {
            await db.changePositionRank(ID, Rank, User);
            res.send({
                ID: ID,
                Rank: Rank,
                User: User
            });    
        }
    }
    else {
        res.status(404).send({ error: "無此地點" });
    }
}));

// edit Map info
router.put('/emi', auth.checkUserSession, validate(addPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */

    const db = req.app.locals.db;
    const Name = req.body.Name;
    const Latitude = req.body.Latitude;
    const Longitude = req.body.Longitude;
    const Address = req.body.Address;
    const Url = req.body.Url;
    const Phone = req.body.Phone;
    //const Renew = req.body.Date;
    const User = req.session.user.id;
    const ID = req.query.ID;
    let mapobj = await db.getPositionByName(Name);
    if (!mapobj.length) {
        res.status(404).send({ error: "Unsuccessful enquiry" });
    }
    else if (mapobj[0].User != User) {
        res.status(403).send({ error: "permission denied " });
    }
    else {
        await db.editMapInfo(ID, Name, Latitude, Longitude, Address, Url, Phone);
        res.send({
            "status": "Done",
            "Name": Name,
            "User": User,
            "Phone": Phone
        });
    }
}))

router.get('/numOfRank', validate(getPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const Name = req.body.Name;

    let info = await db.getPositionByName(Name);
    if(info.length){
        const ID = info[0].ID;
        let data = await db.numberOfRank(ID);
        const count = Object.values(data[0]);
        const value = count[0]
        res.send({
            "count": value
        });
    }
    else{
        res.status(404).send({'error': '無此地點;'})
    }

}));

router.delete('/deleteMap', auth.checkUserSession, validate(checkPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const Name = req.body.Name;

    let info = await db.getPositionByName(Name);
    let len = info.length;
    

    if (len && User == info[0].User) {
        const ID = info[0].ID;
        await db.deleteAllRank(ID);
        await db.deletePosition(ID, User);
        res.send({
            message: "成功!!",
            Name: Name
        });
    }
    else {
        res.status(404).send({ error: "錯誤操作" });
    }
}));

router.delete('/deleteRank', auth.checkUserSession, validate(checkPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const Name = req.body.Name;

    let info = await db.getPositionByName(Name);
    let len = info.length;

    if (len) {
        const ID = info[0].ID;
        let exist = await db.getRankExistence(ID,User);
        if(exist === -1)
            res.status(403).send({error:"無此評分資訊"});
        else{
            await db.deleteRank(ID, User);
            res.send({
                message: "成功!!",
                Name: Name
            });
        }

    }
    else {
        res.status(404).send({ error: "無此地點!!" });
    }
}));

module.exports = router;
