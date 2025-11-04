const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization'); // Yeni import
const { logActivity } = require('../utils/activityLogger');

// 1. Yeni Görev Listesi (Sütun) Oluştur (Yetki: EDITOR veya üstü)
exports.createTaskList = async (req, res) => {
  const { title, boardId } = req.body;
  const userId = req.user.id;

  if (!title || !boardId) return res.status(400).json({ msg: 'Başlık ve Pano ID gerekli.' });

  try {
    const userRole = await getUserRoleInBoard(userId, boardId);
    if (!hasRequiredRole('EDITOR', userRole)) {
      return res.status(403).json({ msg: 'Bu panoda liste oluşturma yetkiniz yok.' });
    }

    const listCount = await prisma.taskList.count({ where: { boardId } });
    const newTaskList = await prisma.taskList.create({
      data: { title: title.trim(), boardId: boardId, order: listCount },
    });

    await logActivity(userId, boardId, 'CREATE_LIST', `"${newTaskList.title}" listesini oluşturdu`, null, newTaskList.id);
    res.status(201).json(newTaskList);
  } catch (err) { console.error("createTaskList Hatası:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 2. Liste Başlığını Güncelle (Yetki: EDITOR veya üstü)
exports.updateTaskListTitle = async (req, res) => {
  const { listId } = req.params;
  const { title } = req.body;
  const userId = req.user.id;

  if (!title || title.trim() === '') return res.status(400).json({ msg: 'Başlık boş olamaz.'});

  try {
    const taskList = await prisma.taskList.findUnique({ where: { id: listId }, select: { boardId: true, title: true } });
    if (!taskList) return res.status(404).json({ msg: 'Liste bulunamadı.' });
    const boardId = taskList.boardId;

    const userRole = await getUserRoleInBoard(userId, boardId);
    if (!hasRequiredRole('EDITOR', userRole)) {
      return res.status(403).json({ msg: 'Liste adını değiştirme yetkiniz yok.' });
    }

    const updatedList = await prisma.taskList.update({ where: { id: listId }, data: { title: title.trim() } });

    if (taskList.title !== updatedList.title) {
        await logActivity(userId, boardId, 'UPDATE_LIST_NAME', `Liste adını "${taskList.title}" iken "${updatedList.title}" olarak değiştirdi`, null, listId);
    }
    res.json(updatedList);
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Liste bulunamadı.' });
      console.error("updateTaskListTitle Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 3. Listeyi Sil (Yetki: EDITOR veya üstü)
exports.deleteTaskList = async (req, res) => {
  const { listId } = req.params;
  const userId = req.user.id;

  try {
    const taskList = await prisma.taskList.findUnique({ where: { id: listId }, select: { boardId: true, title: true } });
    if (!taskList) return res.status(404).json({ msg: 'Liste bulunamadı.' });
    const boardId = taskList.boardId;

    const userRole = await getUserRoleInBoard(userId, boardId);
    if (!hasRequiredRole('EDITOR', userRole)) {
      return res.status(403).json({ msg: 'Liste silme yetkiniz yok.' });
    }

    await prisma.taskList.delete({ where: { id: listId } }); // Cascade silme görevleri de siler
    await logActivity(userId, boardId, 'DELETE_LIST', `"${taskList.title}" listesini sildi`, null, listId);
    res.json({ msg: 'Liste başarıyla silindi.' });
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Liste bulunamadı.' });
      console.error("deleteTaskList Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 4. LİSTE İÇİNDEKİ GÖREVLERİ YENİDEN SIRALAMA (Yetki: MEMBER veya üstü)
exports.reorderTasks = async (req, res) => {
    const { listId } = req.params;
    const tasksOrder = req.body; // [{ taskId: "id", order: number }, ...]
    const userId = req.user.id;

    if (!Array.isArray(tasksOrder) || tasksOrder.some(item => !item.taskId || typeof item.order !== 'number')) {
        return res.status(400).json({ msg: 'Geçersiz veri formatı.' });
     }

    try {
        const taskList = await prisma.taskList.findUnique({ where: { id: listId }, select: { boardId: true, title: true } });
        if (!taskList) return res.status(404).json({ msg: 'Liste bulunamadı.' });
        const boardId = taskList.boardId;

        const userRole = await getUserRoleInBoard(userId, boardId);
        if (!hasRequiredRole('MEMBER', userRole)) { // Sıralama için MEMBER yeterli
            return res.status(403).json({ msg: 'Görev sırasını değiştirme yetkiniz yok.' });
        }

        const updatePromises = tasksOrder.map(item =>
            prisma.task.updateMany({ where: { id: item.taskId, taskListId: listId }, data: { order: item.order } })
        );
        await prisma.$transaction(updatePromises);
        await logActivity(userId, boardId, 'REORDER_TASKS', `"${taskList.title}" listesindeki görev sırasını güncelledi`, null, listId);
        res.json({ msg: 'Görev sırası başarıyla güncellendi.' });

    } catch (err) {
        console.error("reorderTasks Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
       }
};