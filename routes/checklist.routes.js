const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const checklistController = require('../controllers/checklist.controller');
const multer = require('multer');

// Middleware'ler
const setUploadPath = require('../middleware/setUploadPath');
const uploadChecklistImages = require('../middleware/uploadChecklist');

// @route   POST /api/checklist/task/:taskId
// @desc    Bir ana göreve (Task) yeni bir alt eleman (ChecklistItem) ekler (dueDate dahil)
// @access  Private
router.post('/task/:taskId', authMiddleware, checklistController.addChecklistItem);

// @route   PUT /api/checklist/:itemId/toggle
// @desc    Bir alt elemanın 'tik'ini (isCompleted) değiştirir
// @access  Private
router.put('/:itemId/toggle', authMiddleware, checklistController.toggleChecklistItem);

// @route   DELETE /api/checklist/:itemId
// @desc    Bir alt elemanı (checklistItem) siler (resimleriyle birlikte)
// @access  Private
router.delete('/:itemId', authMiddleware, checklistController.deleteChecklistItem);

// --- YENİ ROTA ---
// @route   PUT /api/checklist/:itemId
// @desc    Bir alt elemanın metnini ve/veya bitiş tarihini günceller
// @access  Private
router.put('/:itemId', authMiddleware, checklistController.updateChecklistItem);
// --- BİTİŞ ---

// @route   POST /api/checklist/:itemId/assign
// @desc    Bir alt elemana kullanıcı atar
// @access  Private
router.post('/:itemId/assign', authMiddleware, checklistController.assignToChecklistItem);

// @route   POST /api/checklist/:itemId/unassign
// @desc    Bir alt elemandan kullanıcı atamasını kaldırır
// @access  Private
router.post('/:itemId/unassign', authMiddleware, checklistController.unassignFromChecklistItem);

// @route   POST /api/checklist/:itemId/images
// @desc    Bir alt-göreve resim(ler) yükler (Max 5) (Dinamik Klasör ile)
// @access  Private
router.post(
  '/:itemId/images',
  authMiddleware,      // 1. Kullanıcıyı doğrula
  setUploadPath,       // 2. Yükleme yolunu belirle
  (req, res, next) => { // 3. Multer hatalarını yakala
    uploadChecklistImages(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const MAX_SIZE_MB = process.env.MAX_UPLOAD_SIZE_MB || 10;
          return res.status(400).json({ msg: `Dosya boyutu ${MAX_SIZE_MB} MB'ı geçemez.` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ msg: 'Aynı anda en fazla 5 resim yükleyebilirsiniz.' });
        }
        return res.status(400).json({ msg: err.message });
      } else if (err) {
        return res.status(400).json({ msg: err.message });
      }
      next();
    });
  },
  checklistController.addImagesToChecklistItem // 4. Kontrolcüyü çalıştır
);

// @route   DELETE /api/checklist/image/:imageId
// @desc    Bir alt-görevden bir resmi siler
// @access  Private
router.delete('/image/:imageId', authMiddleware, checklistController.deleteChecklistImage);

module.exports = router;