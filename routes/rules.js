const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');
const {checkUserSession} = require("./auth");
const {late} = require("zod");

const router = express.Router();

const postRuleSchema = z.object({
    params: z.object({
        sp_type: z.coerce.number()
    }),
    body: z.object({
        fromVersion: z.number(),
        rules: z.string(),
    })
})

const getRuleSchema = z.object({
    params: z.object({
        sp_type: z.coerce.number()
    })
})

const approveSchema = z.object({
    params: z.object({
        r_id: z.coerce.number()
    })
});

router.put('/sports/:sp_type', auth.checkUserSession, validate(postRuleSchema), wrap(async (req, res)=>{
    /**
     * @type {DB};
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const sp_type = req.params.sp_type;
    const rules = req.body.rules;
    const fromVersion = req.body.fromVersion;

    let sport = await db.getSportById(sp_type);
    if(!sport.length)
    {
        res.status(404).send({error: "此運動類別不存在"});
    }
    else
    {
        let code = await db.newRule(user_id, sp_type, rules, fromVersion);
        if(code === 1 /* this edit is not from latest */)
        {
            res.status(409 /* conflict */).send({error: "This edit is not from the latest version"});
        }
        else if(code === 2 /* this edit is identical with latest */)
        {
            res.status(409 /* conflict */).send({error: "This edit is identical with the latest version"})
        }
        else
        {
            res.send({status: "OK"});
        }
    }
}));

router.get('/sports/:sp_type/latest', validate(getRuleSchema), wrap( async(req, res)=>{
    /**
     * @type DB
     */
    const db = req.app.locals.db;
    const sp_type = req.params.sp_type;
    let sport = await db.getSportById(sp_type);

    if(!sport.length)
    {
        res.status(404).send({error: "此運動類別不存在"})
    }
    else
    {
        let latest = await db.getLatestRule(sp_type);
        if(!latest)
        {
            res.send({
                versionNum: 0,
                rules: null,
            });
        }
        else
        {
            res.send(latest);
        }
    }
}));

router.post('/approve/:r_id', auth.checkUserSession, validate(approveSchema), wrap( async (req, res) =>{
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const r_id = req.params.r_id;
    let code = await db.approveRuleById(user_id, 1, r_id);

    if(code === -1)
    {
        res.status(404).send({error: "No corresponding rule record found"});
    }
    else if(code === 1)
    {
        res.status(409 /* Conflict */).send({error: "User Already has same approval record"});
    }
    else
    {
        res.send({status: "OK"});
    }
}));


router.post('/disapprove/:r_id', auth.checkUserSession, validate(approveSchema), wrap( async (req, res) =>{
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const r_id = req.params.r_id;
    let code = await db.approveRuleById(user_id, -1, r_id);

    if(code === -1)
    {
        res.status(404).send({error: "No corresponding rule record found"});
    }
    else if(code === 1)
    {
        res.status(409 /* Conflict */).send({error: "User Already has same approval record"});
    }
    else
    {
        res.send({status: "OK"});
    }
}));

module.exports = router;
