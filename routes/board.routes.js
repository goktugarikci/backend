const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const boardController = require('../controllers/board.controller');

// @route   POST /api/boards
// @desc    Yeni pano (grup) oluştur
// @access  Private
router.post('/', authMiddleware, boardController.createBoard);

// @route   GET /api/boards/myboards
// @desc    Üye olduğum panoları listele
// @access  Private
router.get('/myboards', authMiddleware, boardController.getMyBoards);

// @route   GET /api/boards/:boardId
// @desc    Tek bir panonun tüm detaylarını (listeler, görevler vb.) getir
// @access  Private
router.get('/:boardId', authMiddleware, boardController.getBoardById);

// @route   PUT /api/boards/:boardId
// @desc    Pano adını güncelle (Sadece Oluşturan Kişi)
// @access  Private
router.put('/:boardId', authMiddleware, boardController.updateBoard);

// @route   POST /api/boards/:boardId/members
// @desc    Panoya e-posta ile yeni üye ekle (Sadece Oluşturan Kişi)
// @access  Private
router.post('/:boardId/members', authMiddleware, boardController.addMemberByEmail);

// @route   DELETE /api/boards/:boardId/members
// @desc    Panodan üye çıkar (Sadece Oluşturan Kişi)
// @access  Private
router.delete('/:boardId/members', authMiddleware, boardController.removeMember);

// @route   DELETE /api/boards/:boardId
// @desc    Panoyu (grubu) ve tüm içeriğini kalıcı olarak siler (Sadece Oluşturan Kişi)
// @access  Private
router.delete('/:boardId', authMiddleware, boardController.deleteBoard);

router.put('/:boardId/lists/reorder', authMiddleware, boardController.reorderLists);

// --- YENİ ROTA ---
// @route   PUT /api/boards/:boardId/members/:memberUserId/role
// @desc    Bir panodaki üyenin rolünü değiştirir
// @access  Private (Admin Gerekli)
router.put('/:boardId/members/:memberUserId/role', authMiddleware, boardController.changeMemberRole);
// --- BİTİŞ ---

module.exports = router;