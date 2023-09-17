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
    params: z.object({
        q_id: z.coerce.number(), // corresponding question id
    }),
    body: z.object({
        a_content: z.string().min(10),
    }),
});

const GetQuestionsSchema = z.object({
    query: z.object({
        sp_type: z.coerce.number().optional()
    }),
});

const GetAnswersSchema = z.object({
    params: z.object({
        q_id: z.coerce.number()
    }),
});

const EditQuestionSchema = z.object({
    params: z.object({
        q_id: z.coerce.number(),
    }),
    body: z.object({
        sp_type: z.number(),
        q_title: z.string().max(30).min(2),
        q_content: z.string().min(2),
    })
})

const DeleteQSchema = z.object({
    params: z.object({
        q_id: z.coerce.number()
    })
})

const router = express.Router();

// 先檢查登入狀態，確認已登入後存資料
// add question
router.post('/questions', auth.checkUserSession, validate(AddQuestionSchema), wrap(async(req, res) => {
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

// add answer
router.post('/questions/:q_id/answers', auth.checkUserSession, validate(AddAnswerSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const q_id = req.params.q_id;
    const a_content = req.body.a_content;

    let question = await db.getQuestionById(q_id);
    if(question.length)
    {
        await db.addAnswer(user_id, q_id, a_content);
        res.send({
            status: "OK",
            question_id: q_id,
            q_title: question[0].q_title,
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

// get all questions (of a type of sport)
router.get('/questions', validate(GetQuestionsSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const sp_type = req.query.sp_type;
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

// get answers of a question
router.get('/questions/:q_id/answers', validate(GetAnswersSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const q_id = req.params.q_id;
    let question = await db.getQuestionById(q_id)
    if(!question.length)
    {
        res.status(400).send({error: "Question Not Found!"});
    }
    else
    {
        let answers = await db.getAnswers(q_id);
        res.send({question: question, answers: answers});
    }
}));

// Edit Question
router.put('/question/:q_id', auth.checkUserSession, validate(EditQuestionSchema), wrap(async(req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const user_id = req.session.user.id;
    const q_id = req.params.q_id;
    const sp_type = req.body.sp_type;
    const q_title = req.body.q_title;
    const q_content = req.body.q_content;
    let question = await db.getQuestionById(q_id);
    if(!question.length)
    {
        res.status(400).send({error: "Question Not Found!"});
    }
    else if(question[0].user_id !== user_id)
    {
        res.status(401).send({error: "permission denied"});
    }
    else
    {
        await db.editQuestion(q_id, sp_type, q_title, q_content);
        res.send({
           status: "OK",
           q_id: q_id,
           sp_type: sp_type,
           q_title: q_title,
           q_content: q_content
        });
    }
}));

router.delete('/questions/:q_id', auth.checkUserSession, validate(DeleteQSchema), wrap(async (req, res)=>{
    const q_id = req.params.q_id;
    res.send({q_id: q_id});
}));

module.exports = router;
