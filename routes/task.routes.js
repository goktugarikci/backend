const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // JWT koruması
const taskController = require('../controllers/task.controller');

// @route   POST /api/tasks
// @desc    Yeni bir görev (kart) oluştur
// @access  Private
router.post('/', authMiddleware, taskController.createTask);

// @route   PUT /api/tasks/:taskId
// @desc    Bir görevin tüm detaylarını günceller
// @access  Private
router.put('/:taskId', authMiddleware, taskController.updateTask);

// @route   DELETE /api/tasks/:taskId
// @desc    Bir görevi sil
// @access  Private
router.delete('/:taskId', authMiddleware, taskController.deleteTask);

// --- Görev Atama (Sahiplenme) Rotaları ---

// @route   POST /api/tasks/:taskId/assign
// @desc    Bir ana göreve kullanıcı ata
// @access  Private
router.post('/:taskId/assign', authMiddleware, taskController.assignTask);

// --- GÜNCELLEME BURADA ---
// @route   POST /api/tasks/:taskId/unassign
// @desc    Bir ana görevden kullanıcının atamasını kaldır
// @access  Private
// Bu satır yorumdan çıkarıldı ve aktifleştirildi:
router.post('/:taskId/unassign', authMiddleware, taskController.unassignTask);

router.patch('/:taskId/move', authMiddleware, taskController.moveTask);

// @route   POST /api/tasks/:taskId/dependencies
// @desc    Bir göreve bağımlılık ekler
// @access  Private
router.post('/:taskId/dependencies', authMiddleware, taskController.addDependency);

// @route   DELETE /api/tasks/:taskId/dependencies/:dependencyTaskId
// @desc    Bir görevden bağımlılığı kaldırır
// @access  Private
router.delete('/:taskId/dependencies/:dependencyTaskId', authMiddleware, taskController.removeDependency);

// @route   GET /api/tasks/:taskId/dependencies
// @desc    Bir görevin bağımlılıklarını getirir
// @access  Private
router.get('/:taskId/dependencies', authMiddleware, taskController.getDependencies);

module.exports = router;