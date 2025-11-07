// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/routes/timeEntry.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // Tüm endpointler giriş gerektirir
const timeEntryController = require('../controllers/timeEntry.controller');

// --- Görev Bazlı Endpointler ---

// @route   POST /api/tasks/:taskId/time-entries/start
// @desc    Bir görev için zamanlayıcıyı başlatır
// @access  Private (MEMBER veya üstü)
router.post('/tasks/:taskId/time-entries/start', authMiddleware, timeEntryController.startTimeEntry);

// @route   POST /api/tasks/:taskId/time-entries/stop
// @desc    Bir görev için çalışan zamanlayıcıyı durdurur
// @access  Private (MEMBER veya üstü)
router.post('/tasks/:taskId/time-entries/stop', authMiddleware, timeEntryController.stopTimeEntry);

// @route   POST /api/tasks/:taskId/time-entries
// @desc    Bir göreve manuel zaman girişi ekler
// @access  Private (MEMBER veya üstü)
router.post('/tasks/:taskId/time-entries', authMiddleware, timeEntryController.addManualTimeEntry);

// @route   GET /api/tasks/:taskId/time-entries
// @desc    Bir görevin zaman kayıtlarını listeler (sayfalı)
// @access  Private (VIEWER veya üstü)
router.get('/tasks/:taskId/time-entries', authMiddleware, timeEntryController.getTimeEntriesForTask);


// --- Kullanıcı Bazlı Endpoint ---

// @route   GET /api/user/me/time-entries
// @desc    Giriş yapmış kullanıcının zaman kayıtlarını getirir (tarih aralığı, sayfalı)
// @access  Private
router.get('/user/me/time-entries', authMiddleware, timeEntryController.getTimeEntriesForUser);


// === YENİ EKLENEN ROTASYONLAR (DÜZENLEME VE SİLME) ===

// @route   PUT /api/time-entries/:entryId
// @desc    Mevcut bir zaman girişini günceller (Sadece sahibi veya Pano Admini)
// @access  Private
router.put('/time-entries/:entryId', authMiddleware, timeEntryController.updateTimeEntry);

// @route   DELETE /api/time-entries/:entryId
// @desc    Mevcut bir zaman girişini siler (Sadece sahibi veya Pano Admini)
// @access  Private
router.delete('/time-entries/:entryId', authMiddleware, timeEntryController.deleteTimeEntry);
// === BİTİŞ ===


module.exports = router;