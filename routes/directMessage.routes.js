// routes/directMessage.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Giriş gerekli
const dmController = require('../controllers/directMessage.controller');

// @route   GET /api/dm/conversations
// @desc    Kullanıcının özel konuşmalarını listeler (son mesajla birlikte)
// @access  Private
router.get('/dm/conversations', authMiddleware, dmController.getConversations);

// @route   GET /api/dm/:userId2
// @desc    Belirli bir kullanıcıyla olan mesaj geçmişini getirir (sayfalı)
// @access  Private
router.get('/dm/:userId2', authMiddleware, dmController.getDirectMessages);

// @route   POST /api/dm/:userId2
// @desc    Belirli bir kullanıcıya özel mesaj gönderir (Genellikle WebSocket kullanılır)
// @access  Private
// Bu endpoint sadece REST API üzerinden gönderme ihtiyacı olursa diye eklenebilir.
// Genellikle WebSocket tercih edilir.
// router.post('/dm/:userId2', authMiddleware, async (req, res) => {
//     const senderId = req.user.id;
//     const receiverId = req.params.userId2;
//     const { text } = req.body;
//     try {
//         const newMessage = await dmController.sendDirectMessage({ senderId, receiverId, text });
//         // İsteğe bağlı: WebSocket üzerinden de yayınla?
//         // const io = req.app.get('socketio');
//         // io.to(senderId).to(receiverId).emit('receive_dm', newMessage);
//         res.status(201).json(newMessage);
//     } catch (error) {
//         res.status(500).json({ msg: error.message });
//     }
// });

module.exports = router;