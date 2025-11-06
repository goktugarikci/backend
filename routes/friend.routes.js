const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Tüm endpoint'ler giriş gerektirir
const friendController = require('../controllers/friend.controller');

// @route   POST /api/friends/request
// @desc    Kullanıcı adı veya e-posta ile arkadaşlık isteği gönderir
// @access  Private
router.post('/request', authMiddleware, friendController.sendFriendRequest);

// @route   GET /api/friends/requests
// @desc    Kullanıcının bekleyen (gelen/giden) isteklerini listeler
// @access  Private
router.get('/requests', authMiddleware, friendController.listPendingRequests);

// @route   PUT /api/friends/requests/:requestId
// @desc    Bir arkadaşlık isteğini yanıtlar (Kabul veya Red)
// @access  Private
// @body    { "response": "ACCEPT" | "DECLINE" }
router.put('/requests/:requestId', authMiddleware, friendController.respondToRequest);

// @route   GET /api/friends
// @desc    Kullanıcının kabul edilmiş arkadaşlarını listeler
// @access  Private
router.get('/', authMiddleware, friendController.listFriends);

// @route   DELETE /api/friends/:friendId
// @desc    Bir arkadaşı siler (Unfriend)
// @access  Private
router.delete('/:friendId', authMiddleware, friendController.removeFriend);


module.exports = router;