const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');
const AddInviteSchema = z.object({
    body: z.object({
        Name: z.string(),
        Content: z.string(),
        Place: z.string(),
        sp_type: z.number(),
        DateTime: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$')),
        Other: z.string()
    }),
});

const router = express.Router();

router.post('/invitation'/*, auth.checkUserSession*/, validate(AddInviteSchema), wrap(async(req, res) => {
     /**
      * @type {DB}
      */

     const db = req.app.locals.db;
     const User_id = req.session.user.id;
     //const User_id = "Test";
     const Name = req.body.Name;
     const Content = req.body.Content;
     const Place = req.body.Place;
     const sp_type = req.body.sp_type;
     const DateTime = req.body.DateTime;
     const Other = req.body.Other;
     await db.addInvite(User_id, Name, Content, Place, sp_type, DateTime, Other);
     res.send({
        status: "Success!!",
        user: User_id,
        Name: Name,
    });
}));

router.get('/invitation', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    
    let results = await db.getInvite();
    if(!results.length)
    {
         res.status(400).send({error: "無邀請"});
    }
    else
    {
         res.send(results);
    }
}));

router.get('/invitation/InviteType', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const sp_type = req.query.sp_type;
    let results = await db.getInviteType(sp_type);
    if(!sp_type){
        res.status(400).send({error: "未輸入sp_type或格式錯誤"});
    }
    else if(!results.length)
    {
         res.status(404).send({error: "查無此類型邀請"});
    }
    else
    {
         res.send(results);
    }
}));

router.put('/invitation/EditInvite', auth.checkUserSession, validate(AddInviteSchema),wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const User_id = req.session.user.id;
    //const User_id = "Test";
    const Name = req.body.Name;
    const Content = req.body.Content;
    const Place = req.body.Place;
    const sp_type = req.body.sp_type;
    const DateTime = req.body.DateTime;
    const Other = req.body.Other;
    const c_id = req.query.c_id;
    
    let contents = await db.getInviteById(c_id);

    if(!contents.length)
    {
        res.status(404).send({error: "查無邀請"});
    }
    else if(contents[0].User_id !== User_id)
    {
        res.status(401).send({error: "permission denied"});
    }
    else
    {
        await db.editInvite(c_id, Name, Content, Place, sp_type,DateTime, Other);
        res.send({
            status: "Success!!",
            user: User_id,
        });
    }
}));

module.exports = router;