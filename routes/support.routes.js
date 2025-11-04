const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Giriş kontrolü
const adminAuthMiddleware = require('../middleware/adminAuth'); // Admin kontrolü
const supportController = require('../controllers/support.controller');
const multer = require('multer');

// Destek bileti resim yükleme middleware'i
const uploadSupportImages = require('../middleware/uploadSupport');

// --- Kullanıcı Endpoint'leri ---

// @route   POST /api/support/tickets
// @desc    Yeni bir destek bileti oluşturur (Resimlerle birlikte)
// @access  Private (Giriş yapmış olmak zorunlu)
router.post(
  '/tickets',
  authMiddleware, // Giriş yapmış mı?
  (req, res, next) => { // Multer hata yakalama
    uploadSupportImages(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const MAX_SIZE_MB = process.env.MAX_UPLOAD_SIZE_MB || 10;
          return res.status(400).json({ msg: `Dosya boyutu ${MAX_SIZE_MB} MB'ı geçemez.` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ msg: 'En fazla 3 resim yükleyebilirsiniz.' });
        }
        return res.status(400).json({ msg: err.message });
      } else if (err) {
        return res.status(400).json({ msg: err.message });
      }
      next();
    });
  },
  supportController.createTicket
);

// @route   POST /api/support/tickets/:ticketId/comments
// @desc    Kullanıcının kendi biletine veya Admin'in bir bilete yorum eklemesi
// @access  Private (Giriş yapmış olmak ve yetkili olmak zorunlu)
router.post(
    '/tickets/:ticketId/comments',
    authMiddleware,
    supportController.addCommentToTicket
);


// --- Admin Endpoint'leri ---
// Bu rotalardan önce hem 'authMiddleware' hem de 'adminAuthMiddleware' çalışır.

// @route   GET /api/support/tickets
// @desc    Tüm destek biletlerini listeler (Sadece Admin)
// @access  Admin
router.get(
    '/tickets',
    authMiddleware,
    adminAuthMiddleware,
    supportController.getAllTickets
);

// @route   GET /api/support/tickets/:ticketId
// @desc    Tek bir destek biletinin detaylarını getirir (Sadece Admin)
// @access  Admin
router.get(
    '/tickets/:ticketId',
    authMiddleware,
    adminAuthMiddleware,
    supportController.getTicketById
);

// @route   PUT /api/support/tickets/:ticketId/status
// @desc    Bir destek biletinin durumunu günceller (Sadece Admin)
// @access  Admin
router.put(
    '/tickets/:ticketId/status',
    authMiddleware,
    adminAuthMiddleware,
    supportController.updateTicketStatus
);

// (İsteğe bağlı: Bileti bir Admine atama endpoint'i eklenebilir)
// router.put('/tickets/:ticketId/assign', authMiddleware, adminAuthMiddleware, supportController.assignTicketToAdmin);

// (İsteğe bağlı: Bilet resmini silme endpoint'i eklenebilir)
// router.delete('/tickets/image/:imageId', authMiddleware, adminAuthMiddleware, supportController.deleteTicketImage);


module.exports = router;