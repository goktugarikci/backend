const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const commentController = require('../controllers/comment.controller');

// @route   POST /api/tasks/:taskId/comments
// @desc    Bir göreve yeni yorum ekler
// @access  Private (Pano üyeliği gerekli)
router.post('/tasks/:taskId/comments', authMiddleware, commentController.createComment);

// @route   GET /api/tasks/:taskId/comments
// @desc    Bir görevin yorumlarını listeler
// @access  Private (Pano üyeliği gerekli)
router.get('/tasks/:taskId/comments', authMiddleware, commentController.getCommentsForTask);

// @route   DELETE /api/comments/:commentId
// @desc    Bir yorumu siler (Yazan kişi veya Admin/Creator)
// @access  Private
router.delete('/comments/:commentId', authMiddleware, commentController.deleteComment);

module.exports = router;