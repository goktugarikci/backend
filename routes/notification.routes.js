const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Tüm endpointler giriş gerektirir
const notificationController = require('../controllers/notification.controller');

// @route   GET /api/notifications
// @desc    Kullanıcının bildirimlerini getirir (sayfalı, ?unreadOnly=true)
// @access  Private
router.get('/', authMiddleware, notificationController.getNotifications);

// @route   PATCH /api/notifications/:notificationId/read
// @desc    Tek bir bildirimi okundu olarak işaretler
// @access  Private
router.patch('/:notificationId/read', authMiddleware, notificationController.markAsRead);

// @route   POST /api/notifications/read-all
// @desc    Kullanıcının tüm okunmamış bildirimlerini okundu yapar
// @access  Private
router.post('/read-all', authMiddleware, notificationController.markAllAsRead);

module.exports = router;