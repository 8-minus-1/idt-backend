const express = require('express');
const DB = require('../db');
const { wrap } = require('../utils');
const { checkUserSession } = require('./auth');

const router = express.Router();

router.get('/', checkUserSession, wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const { id } = req.session.user;
    const chats = await db.getChats(id);
    const mapped = chats.map(
        ({ id, name, last_message_sender_name, last_message_type, last_message_content, last_message_created_at }) => ({
            id,
            name,
            lastMessage: {
                senderName: last_message_sender_name,
                type: last_message_type,
                content: last_message_content,
                createdAt: last_message_created_at,
            },
        })
    );
    res.send(mapped);
}));

module.exports = router;
