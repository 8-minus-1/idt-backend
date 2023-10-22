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
        City: z.number(),
        Town: z.number(),
        Address: z.string(),
        OpenTime: z.string().regex(new RegExp('^\\d{2}:\\d{2}:\\d{2}$')),
        CloseTime: z.string().regex(new RegExp('^\\d{2}:\\d{2}:\\d{2}$')),
        Price:z.string(),
        Parking: z.string(),
        sp_type: z.string(),
        Url: z.string(),
        Phone: z.string()
    }),
});

const addPositionRank = z.object({
    body: z.object({
        ID: z.number(),
        Rank: z.number()
    }),
});

const addPositionPhoto = z.object({
    body: z.object({
        ID: z.number(),
        PhotoID: z.number()
    })
});

const getPosition = z.object({
    query: z.object({
        id: z.coerce.number()
    }),
});

const getPhotoID = z.object({
    query: z.object({
        PhotoID: z.number()
    })
});

const searchSchema = z.object({
    params: z.object({
        key: z.string()
    })
})

const router = express.Router();

router.post('/addPosition', auth.checkUserSession, validate(addPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const Name = req.body.Name;
    const City = req.body.City;
    const Town = req.body.Town;
    const Address = req.body.Address;
    const OpenTime = req.body.OpenTime;
    const CloseTime = req.body.CloseTime;
    const Price = req.body.Price;
    const Parking = req.body.Parking;
    const sp_type = req.body.sp_type;
    const Url = req.body.Url;
    const Phone = req.body.Phone;
    const User = req.session.user.id;
    let info = await db.searchPlaceByName(Name);
    //let info = await db.getPositionById(ID);
    let len = info.length;
    var Renew;

    if (!len) {
        await db.addMap(Name, City, Town, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone, Renew, User);
        res.send({
            status: "OK",
            Name: Name,
            City: City,
            Town: Town,
            Address: Address,
            OpenTime: OpenTime,
            CloseTime: CloseTime,
            Price: Price,
            Parking: Parking,
            sp_type: sp_type,
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
    const id = req.query.id;

    let info = await db.getPositionById(id);
    let len = info.length;
    if (len) {
        res.send(info[0]);
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
    
    const ID = req.body.ID;
    const Rank = req.body.Rank;

    let info = await db.getPositionById(ID);
    let len = info.length;

    if (len) {
        const ID = info[0].ID;
        let exist = await db.getRankExistence(ID, User);
        if(exist === -1){
            await db.addPositionRank(ID, Rank, User, info);
            res.send({
                ID: ID,
                Rank: Rank,
                User: User
            });
        }
        else {
            res.status(403).send({ error: "已評價該地點!!" });
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
    const ID = req.query.ID;
    const Rank = req.query.Rank;    

    let info = await db.getPositionById(ID);
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
    const OpenTime = req.body.OpenTime;
    const CloseTime = req.body.CloseTime;
    const Price = req.body.Price;
    const Parking = req.body.Parking;
    const sp_type = req.body.sp_type;
    const Url = req.body.Url;
    const Phone = req.body.Phone;
    //const Renew = req.body.Date;
    const User = req.session.user.id;
    const ID = req.query.ID;

    let mapobj = await db.getPositionById(ID);
    if (!mapobj.length) {
        res.status(404).send({ error: "Unsuccessful enquiry" });
    }
    else if (mapobj[0].User != User) {
        res.status(403).send({ error: "permission denied " });
    }
    else {
        await db.editMapInfo(ID,Name, Latitude, Longitude, Address, OpenTime, CloseTime, Price, Parking, sp_type, Url, Phone);
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
    const ID = req.query.id;

    let info = await db.getPositionById(ID);
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

router.delete('/deleteMap', auth.checkUserSession, validate(getPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const ID = req.query.id;

    let info = await db.getPositionById(ID);
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

router.delete('/deleteRank', auth.checkUserSession, validate(getPosition), wrap(async (req, res) => {
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User = req.session.user.id;
    const ID = req.query.id;

    let info = await db.getPositionById(ID);
    let len = info.length;

    if (len) {
        const ID = info[0].ID;
        let exist = await db.getRankExistence(ID, User);
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

router.delete('/deletePhoto', auth.checkUserSession, validate(getPhotoID), wrap(async (req, res) => {
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const PhotoID = req.body.PhotoID;

    let info = await db.getphotoByphotoid(PhotoID);
    let len = info.length;

    if (len) {
        await db.deletephotoByphotoid(PhotoID);
        res.send({
            message: "成功!!",
            PhotoID: PhotoID
        });
    }
    else {
        res.status(404).send({ error: "無此照片!!" });
    }
}));

router.post('/addPhoto', auth.checkUserSession, validate(addPositionPhoto), wrap(async (req, res) => {
    /** 
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const ID = req.body.ID;
    const PhotoID = req.body.PhotoID;
    const User = req.session.user.id;

    let info = await db.getPositionById(ID);
    if(info.length){
        const ID = info[0].ID;
        let PhotoInfo = await db.getPhotoInfo(ID,User);
        
        if(!PhotoInfo.length){
            await db.addPhoto(ID,User,PhotoID);
            res.send(
                {status:'OK', Name:Name,User:User}
            );
        }
        else
            res.status(405).send({error:"重覆上傳照片!"});
    }
    else
        res.status(404).send({error:"無此地點"});

}));

router.get('/search/:key', validate(searchSchema), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const keywords = req.params.key;
    let results = await db.searchPlaceByName(keywords);
    res.send(results);
}))

router.get('/allPos',  wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    let results = await db.getAllPosition();
    if(results.length)
        res.send(results);
    else
        res.status(404).send("目前資料庫沒有資料");
}))

module.exports = router;