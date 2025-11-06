const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // JWT doğrulama
const uploadMiddleware = require('../middleware/upload'); // Multer yükleme
const multer = require('multer'); // <-- EKSİK OLAN SATIR BU
// Kullanıcı kontrolcüsünü içe aktar
const userController = require('../controllers/user.controller');

// @route   PUT /api/user/change-password
// @desc    Kullanıcının şifresini değiştirir (giriş yapmış olmayı gerektirir)
// @access  Private
router.put('/change-password', authMiddleware, userController.changePassword);

// @route   PUT /api/user/update-name
// @desc    Kullanıcının ismini günceller (giriş yapmış olmayı gerektirir)
// @access  Private
router.put('/update-name', authMiddleware, userController.updateProfileName);
router.put('/update-username', authMiddleware, userController.updateUsername);
router.get('/me', authMiddleware, userController.getMe);

// @route   POST /api/user/profile-image
// @desc    Kullanıcının profil resmini yükler/günceller (giriş yapmış olmayı gerektirir)
// @access  Private
// upload.single('profileImage') -> Formdan 'profileImage' adlı bir dosya bekler
router.post(
  '/profile-image',
  authMiddleware,
  (req, res, next) => {
    uploadMiddleware.single('profileImage')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const MAX_SIZE_MB = process.env.MAX_UPLOAD_SIZE_MB || 10;
          return res.status(400).json({ msg: `Dosya boyutu çok büyük. Maksimum ${MAX_SIZE_MB} MB olmalıdır.` });
        }
        return res.status(400).json({ msg: `Dosya yükleme hatası: ${err.message}` });
      } 
      else if (err) {
        return res.status(400).json({ msg: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ msg: 'Lütfen bir resim dosyası seçin.' });
      }
      next();
    });
  },
  userController.uploadProfileImage
);

// @route   GET /api/user/me/tasks
// @desc    Giriş yapmış kullanıcının atanmış tüm görevlerini getirir (filtrelenebilir/sıralanabilir)
// @access  Private
router.get('/me/tasks', authMiddleware, userController.getMyAssignedTasks);

module.exports = router;