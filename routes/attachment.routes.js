const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const attachmentController = require('../controllers/attachment.controller');
const multer = require('multer');

// Middleware'ler
const setAttachmentUploadPath = require('../middleware/setAttachmentUploadPath');
const uploadAttachments = require('../middleware/uploadAttachment');

// @route   POST /api/tasks/:taskId/attachments
// @desc    Bir göreve bir veya daha fazla ek yükler (Max 5)
// @access  Private
router.post(
  '/tasks/:taskId/attachments',
  authMiddleware,
  setAttachmentUploadPath, // Önce yolu belirle
  (req, res, next) => { // Sonra Multer hatalarını yakala
    uploadAttachments(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') { /*...*/ }
        if (err.code === 'LIMIT_FILE_COUNT') { /*...*/ }
        return res.status(400).json({ msg: err.message });
      } else if (err) { return res.status(400).json({ msg: err.message }); }
      next();
    });
  },
  attachmentController.uploadAttachments // Son olarak kontrolcüyü çalıştır
);

// @route   GET /api/tasks/:taskId/attachments
// @desc    Bir görevin tüm eklerini listeler
// @access  Private
router.get('/tasks/:taskId/attachments', authMiddleware, attachmentController.getAttachmentsForTask);

// @route   DELETE /api/attachments/:attachmentId
// @desc    Bir eki siler
// @access  Private (Yükleyen veya Creator/Admin)
router.delete('/attachments/:attachmentId', authMiddleware, attachmentController.deleteAttachment);


module.exports = router;