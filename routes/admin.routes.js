const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Önce giriş yapmış olmalı
const adminAuthMiddleware = require('../middleware/adminAuth'); // Sonra Admin olmalı
const adminController = require('../controllers/admin.controller');

// Tüm bu rotalar önce authMiddleware'den, sonra adminAuthMiddleware'den geçer

// === Pano Yönetimi ===
router.get('/boards', authMiddleware, adminAuthMiddleware, adminController.getAllBoards);
router.get('/boards/:boardId', authMiddleware, adminAuthMiddleware, adminController.getBoardDetailsAdmin);
router.delete('/boards/:boardId', authMiddleware, adminAuthMiddleware, adminController.deleteAnyBoard); // Herhangi bir panoyu silme
router.patch('/boards/:boardId/transfer-ownership', authMiddleware, adminAuthMiddleware, adminController.transferBoardOwnership); // Sahiplik aktarma

// === Kullanıcı Yönetimi ===
router.get('/users', authMiddleware, adminAuthMiddleware, adminController.getAllUsers);
router.get('/users/:userId', authMiddleware, adminAuthMiddleware, adminController.getUserDetailsAdmin);
router.put('/users/:userId/role', authMiddleware, adminAuthMiddleware, adminController.changeUserRole); // Rol değiştirme
router.put('/users/:userId/status', authMiddleware, adminAuthMiddleware, adminController.setUserStatus); // Aktif/Pasif yapma
router.delete('/users/:userId', authMiddleware, adminAuthMiddleware, adminController.deleteUser); // Kullanıcı silme

// === İçerik Yönetimi ===
router.delete('/comments/:commentId', authMiddleware, adminAuthMiddleware, adminController.deleteAnyComment); // Herhangi bir yorumu silme
router.delete('/attachments/:attachmentId', authMiddleware, adminAuthMiddleware, adminController.deleteAnyAttachment); // Herhangi bir eki silme

// === Raporlama ===
router.get('/stats', authMiddleware, adminAuthMiddleware, adminController.getSystemStats); // Sistem istatistikleri
router.get('/activity', authMiddleware, adminAuthMiddleware, adminController.getActivityLogs); // Gelişmiş aktivite logları

// === Destek Biletleri Yönetimi ===
// (Not: Destek biletleri için ana endpoint'ler /api/support altında, buraya sadece ek admin işlemleri konulabilir)
router.put('/support/tickets/:ticketId/assign', authMiddleware, adminAuthMiddleware, adminController.assignSupportTicket); // Bileti admine ata
router.delete('/support/tickets/:ticketId', authMiddleware, adminAuthMiddleware, adminController.deleteSupportTicket); // Bileti sil

// === Diğer ===
router.post('/bulk-message', authMiddleware, adminAuthMiddleware, adminController.sendBulkMessage); // Toplu mesaj


module.exports = router;