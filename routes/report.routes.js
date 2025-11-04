// routes/report.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const adminAuthMiddleware = require('../middleware/adminAuth'); // Kullanıcı raporları için gerekebilir
const reportController = require('../controllers/report.controller');

// @route   GET /api/boards/:boardId/reports
// @desc    Pano bazlı raporları getirir (örn: ?reportType=completion)
// @access  Private (EDITOR veya ADMIN)
router.get('/boards/:boardId/reports', authMiddleware, reportController.getBoardReports);

// @route   GET /api/reports/users/:userId
// @desc    Kullanıcı bazlı raporları getirir (Zaman kaydı özeti, tamamlanan görevler)
// @access  Private (Admin veya kullanıcının kendisi)
router.get('/reports/users/:userId', authMiddleware, reportController.getUserReports);


module.exports = router;