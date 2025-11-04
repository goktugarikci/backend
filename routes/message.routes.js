const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const messageController = require('../controllers/message.controller');

// @route   GET /api/messages/board/:boardId
// @desc    Bir panonun (grubun) sohbet geçmişini getirir
// @access  Private
router.get('/board/:boardId', authMiddleware, messageController.getMessagesForBoard);

module.exports = router;