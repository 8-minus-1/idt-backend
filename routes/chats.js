const express = require('express');
const z = require('zod');
const DB = require('../db');
const { wrap, validate } = require('../utils');
const { checkUserSession } = require('./auth');
const { MessageType } = require('../constants');

const router = express.Router();

const GetMessagesRequest = z.object({
    params: z.object({
        inviteId: z.coerce.number().positive().finite(),
    }),
    query: z.object({
        sinceId: z.coerce.number().nonnegative().finite().optional(),
    }),
});

const SendMessageRequest = z.object({
    params: z.object({
        inviteId: z.coerce.number().positive().finite(),
    }),
    body: z.object({
        content: z.string().trim().min(1),
    }),
});

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

router.get('/:inviteId/messages', checkUserSession, validate(GetMessagesRequest), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const { id } = req.session.user;
    const chatIds = await db.getChatIds(id);
    const { inviteId } = req.params;
    if (!chatIds.includes(inviteId)) {
        return res.status(403).end();
    }
    const sinceId = req.query.sinceId ?? 0;
    const messages = await db.getMessages(inviteId, sinceId);
    res.send(messages);
}));

router.post('/:inviteId/messages', checkUserSession, validate(SendMessageRequest), wrap(async (req, res) => {
    /**
     * @type {DB}
     */
    const db = req.app.locals.db;
    const { id } = req.session.user;
    const chatIds = await db.getChatIds(id);
    const { inviteId } = req.params;
    if (!chatIds.includes(inviteId)) {
        return res.status(403).end();
    }
    await db.addMessage(inviteId, id, MessageType.Message, req.body.content);
    res.end();
}));

module.exports = router;
