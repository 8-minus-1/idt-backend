const express = require('express');
const z = require('zod');
const { validate, wrap } = require('../utils');
const DB = require('../db');

// TODO: 直接用 api 或 function 檢查登入狀態以及取得 user_id

const AddQuestionSchema = z.object({
    body: z.object({
        user_id: z.number().nonnegative(),
        sp_type: z.number(),
        q_title: z.string().max(30).min(2),
        q_content: z.string().min(2),
    }),
});

const AddAnswerSchema = z.object({
    body: z.object({
        user_id: z.number().nonnegative(),
        q_id: z.number(),
        a_content: z.string().min(10),
    }),
});

const GetQuestionsSchema = z.object({
    query: z.object({
        sp_type: z.number(),
    }),
});

const GetAnswersSchema = z.object({
    query: z.object({
        q_id: z.number(),
    }),
});

const router = express.Router();

router.post('/addQuestion', validate(AddQuestionSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.body.user_id;
    const sp_type = req.body.sp_type;
    const q_title = req.body.q_title;
    const q_content = req.body.q_content;
    await db.addQuestion(user_id, sp_type, q_title, q_content);
    res.send(`{ Question Added with title "${q_title}" by user ${user_id}`);
}));

router.post('/addAnswer', validate(AddAnswerSchema), wrap(async(req, res) => {
    res.send("{ Answer Added }");
}));

router.get('/getQuestions', validate(GetQuestionsSchema), wrap(async(req, res) => {
    res.send("{  }");
}));

router.get('/getAnswers', validate(GetAnswersSchema), wrap(async(req, res) => {
    res.send("{  }");
}));

module.exports = router;
