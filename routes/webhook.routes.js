const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Giriş
const adminAuthMiddleware = require('../middleware/adminAuth'); // Genel Adminlik (opsiyonel)
const webhookController = require('../controllers/webhook.controller');

// @route   POST /api/webhooks
// @desc    Yeni bir webhook oluşturur
// @access  Private (Pano ADMIN'i olmalı)
router.post('/webhooks', authMiddleware, webhookController.createWebhook);

// @route   GET /api/boards/:boardId/webhooks
// @desc    Bir panonun webhook'larını listeler
// @access  Private (Pano ADMIN'i olmalı)
router.get('/boards/:boardId/webhooks', authMiddleware, webhookController.getWebhooksForBoard);

// @route   DELETE /api/webhooks/:webhookId
// @desc    Bir webhook'u siler
// @access  Private (Pano ADMIN'i olmalı)
router.delete('/webhooks/:webhookId', authMiddleware, webhookController.deleteWebhook);

module.exports = router;