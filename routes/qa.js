const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');
const auth = require('./auth');

const AddQuestionSchema = z.object({
    body: z.object({
        sp_type: z.number(),
        q_title: z.string().max(30).min(2),
        q_content: z.string().min(2),
    }),
});

const AddAnswerSchema = z.object({
    body: z.object({
        q_id: z.number(), // corresponding question id
        a_content: z.string().min(10),
    }),
});

const GetQuestionsSchema = z.object({
    query: z.object({
        sp_type: z.string().refine((val) => !Number.isNaN(parseInt(val, 10)), {message: "Expected number"}).optional(),
    }),
});

const GetAnswersSchema = z.object({
    query: z.object({
        q_id: z.number(),
    }),
});

const router = express.Router();

// 先檢查登入狀態，確認已登入後存資料
router.post('/addQuestion', auth.checkUserSession, validate(AddQuestionSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const sp_type = req.body.sp_type;
    const q_title = req.body.q_title;
    const q_content = req.body.q_content;
    await db.addQuestion(user_id, sp_type, q_title, q_content);
    res.send({
        status: "OK",
        user: user_id,
        q_title: q_title,
        q_content: q_content
    });
}));

router.post('/addAnswer', auth.checkUserSession, validate(AddAnswerSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const q_id = req.body.q_id;
    const a_content = req.body.a_content;

    let exist = await db.checkQuestionExistence(q_id);
    if(exist)
    {
        //TODO: 是否是原Po
        await db.addAnswer(user_id, q_id, a_content);
        res.send({
            status: "OK",
            question_id: q_id,
            answer: a_content
        });
    }
    else
    {
        res.status(400).send({
            message: "Question Not Found"
        })
    }
}));

router.get('/getQuestions', validate(GetQuestionsSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const sp_type = parseInt(req.query.sp_type);
    let results = await db.getQuestions(sp_type);
    if(!results.length)
    {
        res.status(400).send({error: "尚無此類別的問題"});
    }
    else
    {
        res.send(results);
    }
}));

router.get('/getAnswers', validate(GetAnswersSchema), wrap(async(req, res) => {
    res.send({});
}));

module.exports = router;
