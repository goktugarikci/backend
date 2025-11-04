const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // JWT koruması
const reactionController = require('../controllers/reaction.controller');

// @route   POST /api/tasks/:taskId/reactions
// @desc    Bir göreve reaksiyon ekler veya kaldırır (Toggle)
// @access  Private (Pano üyeliği gerekli)
router.post('/tasks/:taskId/reactions', authMiddleware, reactionController.toggleTaskReaction);

// @route   POST /api/comments/:commentId/reactions
// @desc    Bir görevin yorumuna reaksiyon ekler veya kaldırır (Toggle)
// @access  Private (Pano üyeliği gerekli)
router.post('/comments/:commentId/reactions', authMiddleware, reactionController.toggleCommentReaction);

module.exports = router;