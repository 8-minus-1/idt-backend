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
        rules: z.string(),
    })
})

const getRuleSchema = z.object({
    params: z.object({
        sp_type: z.coerce.number()
    })
})

router.post('/sports/:sp_type', auth.checkUserSession, validate(postRuleSchema), wrap(async (req, res)=>{
    /**
     * @type {DB};
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const sp_type = req.params.sp_type;
    const rules = req.body.rules;

    let sport = await db.getSportById(sp_type);
    if(!sport.length)
    {
        res.status(404).send({error: "此運動類別不存在"});
    }
    else
    {

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
            res.status(404).send({message: "此運動目前沒有規則紀錄"});
        }
        else
        {
            res.send(latest);
        }
    }


}))



module.exports = router;
