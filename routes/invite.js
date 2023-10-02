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

module.exports = router;