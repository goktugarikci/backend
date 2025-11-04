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
// Not: Bu rotayı user.routes.js'e de koyabilirdik, ama timeEntry ile ilgili olduğu için burada daha mantıklı.
router.get('/user/me/time-entries', authMiddleware, timeEntryController.getTimeEntriesForUser);


module.exports = router;