const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth'); // JWT koruması
const taskListController = require('../controllers/taskList.controller');

// @route   POST /api/tasklists
// @desc    Yeni bir görev listesi (sütun) oluştur
// @access  Private
router.post('/', authMiddleware, taskListController.createTaskList);

// @route   PUT /api/tasklists/:listId
// @desc    Bir görev listesinin başlığını güncelle
// @access  Private
router.put('/:listId', authMiddleware, taskListController.updateTaskListTitle);

// @route   DELETE /api/tasklists/:listId
// @desc    Bir görev listesini sil
// @access  Private
router.delete('/:listId', authMiddleware, taskListController.deleteTaskList);

router.put('/:listId/tasks/reorder', authMiddleware, taskListController.reorderTasks);

module.exports = router;