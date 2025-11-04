// routes/view.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Giriş gerekli
const viewController = require('../controllers/view.controller');

// @route   GET /api/calendar
// @desc    Takvim görünümü için görevleri/alt görevleri getirir (tarih aralığı, panolar)
// @access  Private
router.get('/calendar', authMiddleware, viewController.getCalendarData);

// @route   GET /api/timeline
// @desc    Zaman çizelgesi/Gantt görünümü için görevleri ve bağımlılıkları getirir (panolar, tarih aralığı opsiyonel)
// @access  Private
router.get('/timeline', authMiddleware, viewController.getTimelineData);

module.exports = router;