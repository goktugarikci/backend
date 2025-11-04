const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const activityController = require('../controllers/activity.controller');

// @route   GET /api/boards/:boardId/activity
// @desc    Bir panonun aktivite loglarını getirir (sayfalı)
// @access  Private (Pano üyeliği gerekli)
router.get('/boards/:boardId/activity', authMiddleware, activityController.getActivityForBoard);

// @route   GET /api/tasks/:taskId/activity
// @desc    Bir görevin aktivite loglarını getirir (sayfalı)
// @access  Private (Pano üyeliği gerekli)
router.get('/tasks/:taskId/activity', authMiddleware, activityController.getActivityForTask);

module.exports = router;