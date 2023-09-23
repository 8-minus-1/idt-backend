const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');
const AddContestSchema = z.object({
    body: z.object({
        Name: z.string(),
        Content: z.string(),
        Place: z.string(),
        sp_type: z.number(),
        StartDate: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')),
        EndDate: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')),
        Deadline: z.string().regex(new RegExp('^\\d{4}-\\d{2}-\\d{2}$')),
        Url: z.string(),
        Other: z.string()
    }),
});

const router = express.Router();

router.post('/contests'/*, auth.checkUserSession*/, validate(AddContestSchema), wrap(async(req, res) => {
     /**
      * @type {DB}
      */

     const db = req.app.locals.db;
     //const User_id = req.session.user.id;
     const User_id = "Test";
     const Name = req.body.Name;
     const Content = req.body.Content;
     const Place = req.body.Place;
     const sp_type = req.body.sp_type;
     const StartDate = req.body.StartDate;
     const EndDate = req.body.EndDate;
     const Deadline = req.body.Deadline;
     const Url = req.body.Url;
     const Other = req.body.Other;
     await db.addContest(User_id, Name, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other);
     res.send({
        status: "Success!!",
        user: User_id,
        Name: Name,
    });
}));

router.get('/contests', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    
    let results = await db.getContest();
    if(!results.length)
    {
         res.status(400).send({error: "無比賽"});
    }
    else
    {
         res.send(results);
    }
}));

router.get('/contests/ordered', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    
    let results = await db.getOrderedContest();
    if(!results.length)
    {
         res.status(400).send({error: "無比賽"});
    }
    else
    {
         res.send(results);
    }
}));


router.get('/contests/SelectType', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const sp_type = req.query.sp_type;
    let results = await db.getSelectType(sp_type);
    if(!sp_type){
        res.status(400).send({error: "未輸入sp_type或格式錯誤"});
    }
    else if(!results.length)
    {
         res.status(404).send({error: "查無此類型比賽"});
    }
    else
    {
         res.send(results);
    }
}));

router.put('/contests/modify', auth.checkUserSession, validate(AddContestSchema),wrap(async(req, res) => {
    
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
    const StartDate = req.body.StartDate;
    const EndDate = req.body.EndDate;
    const Deadline = req.body.Deadline;
    const Url = req.body.Url;
    const Other = req.body.Other;
    const c_id = req.query.c_id;
    
    let contents = await db.getContestById(c_id);

    if(!contents.length)
    {
        res.status(404).send({error: "查無比賽"});
    }
    else if(contents[0].User_id !== User_id)
    {
        res.status(401).send({error: "permission denied"});
    }
    else
    {
        await db.editContest(c_id, Name, Content, Place, sp_type, StartDate, EndDate, Deadline, Url, Other);
        res.send({
            status: "Success!!",
            user: User_id,
        });
    }
}));

router.get('/contests/:c_id', wrap(async(req, res) => {
    
    /**
      * @type {DB}
      */
    const db = req.app.locals.db;
    const c_id = req.params.c_id;
    let contents = await db.getContestById(c_id);
    if(!c_id){
        res.status(400).send({error: "未輸入c_id或格式錯誤"});
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

router.delete('/contests/:c_id', auth.checkUserSession, validate(AddContestSchema), wrap(async (req, res)=>{
    /**
     * @type {DB}
     * */
    const db = req.app.locals.db;
    const User_id = req.session.user.id;
    const c_id = req.params.c_id;

    let contents = await db.getContestById(c_id);

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
        await db.deleteContent(c_id);
        res.send({message: "Success", deleted: contents[0]});
    }
}));
module.exports = router;