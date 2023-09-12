const express = require('express');
const z = require('zod');
const { validate } = require('../utils');

const AddCatRequest = z.object({
    body: z.object({
        name: z.string().trim().min(1),
        age: z.number().nonnegative(),
    }),
});
const router = express.Router();

let cats = [];

router.get('/', (req, res) => {
    res.send(cats);
});

router.post('/', validate(AddCatRequest), (req, res) => {
    cats.push(req.body);
    res.status(201).send({ message: `Created Cat ${req.body.name} aged ${req.body.age}!` });
});

module.exports = router;
