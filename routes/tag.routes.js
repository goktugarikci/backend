const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // JWT koruması
const tagController = require('../controllers/tag.controller');

// @route   POST /api/tags
// @desc    Bir panoya yeni bir etiket oluşturur
// @access  Private (Giriş ve Pano üyeliği gerektirir)
router.post('/', authMiddleware, tagController.createTag);

// @route   DELETE /api/tags/:tagId
// @desc    Bir etiketi siler
// @access  Private (Giriş ve Pano üyeliği gerektirir)
router.delete('/:tagId', authMiddleware, tagController.deleteTag);

module.exports = router;