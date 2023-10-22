const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');
const AddInviteSchema = z.object({
    body: z.object({
        Name: z.string(),
        Place: z.number(),
        sp_type: z.number(),
        DateTime: z.number(),
        Other: z.string()
    }),
});

const getInviteByIdSchema = z.object({
    params: z.object({
        i_id: z.coerce.number()
    })
});

const GetInvitesSchema = z.object({
    query: z.object({
        sp_type: z.coerce.number()
    }),
});

const signupInvitationSchema = z.object({
    params: z.object({
        i_id: z.coerce.number()
    })
})

const router = express.Router();

router.post('/invitation', auth.checkUserSession, validate(AddInviteSchema), wrap(async(req, res) => {
     /**
      * @type {DB}
      */

     const db = req.app.locals.db;
     const User_id = req.session.user.id;
     const Name = req.body.Name;
     const Place = req.body.Place;
     const sp_type = req.body.sp_type;
     const DateTime = req.body.DateTime;
     const Other = req.body.Other;
     await db.addInvite(User_id, Name, Place, sp_type, DateTime, Other);
     res.send({
        status: "Success!",
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

router.get('/invitation/InviteType', validate(GetInvitesSchema), wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const sp_type = req.query.sp_type;
    //let results = await db.getSportById(sp_type);
    let sport = (sp_type)? await db.getSportById(sp_type) : [];

    if(sp_type && !sport.length)
    {
         res.status(404).send({error: "查無此類型邀請"});
    }
    else
    {
        let results = await db.getInviteType(sp_type);
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
    const Place = req.body.Place;
    const sp_type = req.body.sp_type;
    const DateTime = req.body.DateTime;
    const Other = req.body.Other;
    const i_id = req.query.i_id;
    
    let contents = await db.getInviteById(i_id);

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
        await db.editInvite(i_id, Name, Place, sp_type,DateTime, Other);
        res.send({
            status: "Success!!",
            user: User_id,
        });
    }
}));

router.get('/invitation/:i_id', validate(getInviteByIdSchema), wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const i_id = req.params.i_id;
    let contents = await db.getInviteById(i_id);
    if(!i_id){
        res.status(400).send({error: "未輸入i_id或格式錯誤"});
    }
    if(!contents.length)
    {
        res.status(404).send({error: "Content Not Found!"});
    }
    else
    {
        res.send(contents);
    }
}));

router.delete('/invitation/:i_id', auth.checkUserSession, validate(getInviteByIdSchema), wrap(async (req, res)=>{
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User_id = req.session.user.id;
    const i_id = req.params.i_id;

    let contents = await db.getInviteById(i_id);

    if(!contents.length)
    {
        res.status(404).send({error: "Content Not Found!"});
    }
    else if(contents[0].User_id !== User_id)
    {
        console.log(contents[0].User_id, User_id);
        res.status(401).send({error: "permission denied"});
    }
    else
    {
        await db.deleteInvite(i_id);
        res.send({message: "Success", deleted: contents[0]});
    }
}));

router.post('/signup/:i_id', auth.checkUserSession, validate(signupInvitationSchema), wrap( async (req, res)=>
{
    /**
     * @type { DB }
     */
    const db = req.app.locals.db;
    const User_id = req.session.user.id;
    const i_id = req.params.i_id;

    let invitation = await db.getInviteById(i_id);
    console.log(invitation);

    if( !invitation.length )
    {
        res.status(404).send({error: "找不到此公開邀請，故無法報名"});
    }
    else if(invitation[0].User_id === User_id)
    {
        res.status(403).send({error: "無法報名自己建立的活動！"})
    }
    else
    {
        // true or false
        let tof = await db.alreadySignedUp(User_id, i_id);
        if(tof)
        {
            res.status(409 /* Conflict */).send({error: "您已經報名過了"})
        }
        else
        {
            db.signupPublicInv(User_id, i_id);
            res.send({status: "報名成功"})
        }
    }
}));

router.get('/signup/status/:i_id', auth.checkUserSession, validate(signupInvitationSchema), wrap( async (req, res) => {
    const db = req.app.locals.db;
    const User_id = req.session.user.id;
    const i_id = req.params.i_id;
    let invitation = await db.getInviteById(i_id);

    if( !invitation.length )
    {
        res.status(404).send({error: "找不到此公開邀請，故無法報名"});
    }
    else
    {
        // true or false
        let tof = await db.alreadySignedUp(User_id, i_id);
        res.send({status: tof});
    }
}))

module.exports = router;