// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/controllers/task.controller.js
const prisma = require('../lib/prisma');
const { logActivity } = require('../utils/activityLogger'); // Loglama yardımcısı
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization'); // Yetkilendirme yardımcıları
const { createNotification } = require('../utils/notifications'); // GÜNCELLENDİ: Bildirim yardımcısı

// --- YARDIMCI GÜVENLİK FONKSİYONLARI ---

const checkBoardPermission = async (userId, boardId, requiredRole = 'VIEWER') => {
  if (!userId || !boardId) return false;
  try {
    const userRole = await getUserRoleInBoard(userId, boardId);
    return hasRequiredRole(requiredRole, userRole);
  } catch (error) { console.error(`checkBoardPermission error:`, error); return false; }
};
const checkTaskPermission = async (userId, taskId, requiredRole = 'VIEWER') => {
  if (!userId || !taskId) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { taskList: { select: { boardId: true } } },
    });
    if (!task) return false; 
    return await checkBoardPermission(userId, task.taskList.boardId, requiredRole);
  } catch (error) { console.error(`checkTaskPermission error:`, error); return false; }
};

const checkTaskBasicAccess = async (userId, taskId) => checkTaskPermission(userId, taskId, 'VIEWER');
// --- BİTİŞ: YARDIMCI FONKSİYONLAR ---


// 1. Bir listeye yeni bir görev (kart) oluşturur
exports.createTask = async (req, res) => {
  const {
    title,
    taskListId,
    description,
    priority,
    startDate,
    dueDate,
    tagIds
  } = req.body;
  const userId = req.user.id;

  if (!title || !taskListId) return res.status(400).json({ msg: 'Başlık ve Liste ID gerekli.' });

  try {
    const taskList = await prisma.taskList.findUnique({ where: { id: taskListId }, select: { boardId: true } });
    if (!taskList) return res.status(404).json({ msg: 'Liste bulunamadı.' });
    const boardId = taskList.boardId;

    if (!await checkBoardPermission(userId, boardId, 'MEMBER')) {
      return res.status(403).json({ msg: 'Bu panoda görev oluşturma yetkiniz yok.' });
    }

    const taskCount = await prisma.task.count({ where: { taskListId: taskListId }});
    const data = {
      title: title.trim(), taskListId, createdById: userId, description: description || null,
      priority: priority || 'NORMAL',
      startDate: startDate ? new Date(startDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      order: taskCount, tags: undefined
    };
    if (tagIds?.length) data.tags = { connect: tagIds.map(id => ({ id })) };

    const newTask = await prisma.task.create({ data, include: { tags: true, assignees: { select: {id: true, name: true, avatarUrl: true }} } });
    await logActivity(userId, boardId, 'CREATE_TASK', `"${newTask.title}" görevini oluşturdu`, newTask.id, taskListId);
    res.status(201).json(newTask);
  } catch (err) {
      console.error("createTask Hatası:", err.message);
      if (err.code === 'P2003' || err.code === 'P2025') {
          return res.status(400).json({ msg: 'İlişkili liste veya etiket bulunamadı.' });
      }
      res.status(500).send('Sunucu Hatası');
     }
};

// 2. Bir görevin tüm detaylarını günceller (GÜNCELLENDİ: BİLDİRİM EKLENDİ)
exports.updateTask = async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id; // İşlemi yapan kullanıcı
  const { title, description, priority, startDate, dueDate, tagIds, approvalStatus } = req.body;

  try {
    const task = await prisma.task.findUnique({ 
        where: { id: taskId }, 
        select: { 
            title: true, 
            approvalStatus: true, // Eski durumu bilmek için
            assigneeIds: true, 
            createdById: true, // Görevi oluşturanı bilmek için
            taskList: { select: { boardId: true }}
        } 
    });
    if (!task) return res.status(404).json({ msg: 'Görev bulunamadı.' });
    const boardId = task.taskList.boardId;

    const userRole = await getUserRoleInBoard(userId, boardId);
    const isAssigned = task.assigneeIds.includes(userId);

    if (! (hasRequiredRole('EDITOR', userRole) || (hasRequiredRole('MEMBER', userRole) && isAssigned)) ) {
       return res.status(403).json({ msg: 'Bu görevi düzenleme yetkiniz yok.' });
    }

    const dataToUpdate = {};
    let logDetails = [];
    if (title !== undefined) { dataToUpdate.title = title.trim(); if(dataToUpdate.title==='') return res.status(400).json({msg:'Başlık boş olamaz.'}); if(task.title !== dataToUpdate.title) logDetails.push('başlığı'); }
    if (description !== undefined) { dataToUpdate.description = description; logDetails.push('açıklamayı'); }
    if (priority !== undefined && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority.toUpperCase())) { dataToUpdate.priority = priority.toUpperCase(); logDetails.push(`önceliği (${priority.toUpperCase()})`); }
    if (approvalStatus !== undefined && ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'].includes(approvalStatus.toUpperCase())) { dataToUpdate.approvalStatus = approvalStatus.toUpperCase(); logDetails.push(`onay durumunu (${approvalStatus.toUpperCase()})`); }
    if (startDate !== undefined) { dataToUpdate.startDate = startDate ? new Date(startDate) : null; logDetails.push('başlangıç tarihini'); }
    if (dueDate !== undefined) { dataToUpdate.dueDate = dueDate ? new Date(dueDate) : null; logDetails.push('bitiş tarihini'); }
    if (tagIds !== undefined) { dataToUpdate.tags = { set: tagIds.map(id => ({ id })) }; logDetails.push('etiketleri'); }

    if (Object.keys(dataToUpdate).length === 0) return res.status(400).json({ msg: 'Güncellenecek alan belirtilmedi.' });

    const updatedTask = await prisma.task.update({ where: { id: taskId }, data: dataToUpdate, include: { tags: true, assignees: { select: {id: true, name: true, avatarUrl: true }}, taskList: { select: { boardId: true }} } });
    
    // --- GÜNCELLEME: Loglama ve Bildirim ---
    const currentTitle = dataToUpdate.title ? dataToUpdate.title : task.title;
    if (logDetails.length > 0) {
        const logMessage = `"${currentTitle}" görevinin ${logDetails.join(', ')} güncelledi`;
        await logActivity(userId, updatedTask.taskList.boardId, 'UPDATE_TASK_DETAILS', logMessage, taskId);
    }
    
    // YENİ: Görev tamamlandı olarak işaretlendiyse bildirim gönder
    if (dataToUpdate.approvalStatus === 'APPROVED' && task.approvalStatus !== 'APPROVED') {
        const userWhoUpdated = await prisma.user.findUnique({ where: { id: userId }, select: { name: true }});
        const message = `"${userWhoUpdated ? userWhoUpdated.name : 'Biri'}" "${currentTitle}" görevini tamamladı.`;
        
        // Görevi oluşturan + atananlar (işlemi yapan hariç)
        const recipients = new Set([task.createdById, ...task.assigneeIds]);
        recipients.delete(userId); // Kendine bildirim gitmesin
        recipients.delete(null);

        for (const recipientId of recipients) {
            if (recipientId) {
                await createNotification(recipientId, message, boardId, taskId);
            }
        }
    }
    // --- BİTİŞ: GÜNCELLEME ---

    res.json(updatedTask);
  } catch (err) {
      if (err.code === 'P2003' || err.code === 'P2025') return res.status(400).json({ msg: 'Geçersiz veri veya bulunamayan ilişki.' });
      console.error("updateTask Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 3. Bir görevi siler
exports.deleteTask = async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { boardId: true } } } });
    if (!task) return res.status(404).json({ msg: 'Görev bulunamadı.' });
    const boardId = task.taskList.boardId;

    if (!await checkBoardPermission(userId, boardId, 'EDITOR')) {
      return res.status(403).json({ msg: 'Görev silme yetkiniz yok.' });
    }

    await prisma.task.delete({ where: { id: taskId } });
    await logActivity(userId, boardId, 'DELETE_TASK', `"${task.title}" görevini sildi`, taskId);
    res.json({ msg: 'Görev başarıyla silindi.' });
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Görev bulunamadı.' });
      console.error("deleteTask Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

exports.assignTask = async (req, res) => {
  const { taskId } = req.params;
  const { assignUserId } = req.body;
  const requestUserId = req.user.id;

  if (!assignUserId) return res.status(400).json({ msg: 'Atanacak kullanıcı IDsi gerekli.' });
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { boardId: true } }, assigneeIds: true } });
    if (!task) return res.status(404).json({ msg: 'Görev bulunamadı.' });
    const boardId = task.taskList.boardId;

    if (!await checkBoardPermission(requestUserId, boardId, 'EDITOR')) {
      return res.status(403).json({ msg: 'Göreve kullanıcı atama yetkiniz yok.' });
    }
    if (!await getUserRoleInBoard(assignUserId, boardId)) {
      return res.status(400).json({ msg: 'Atanmak istenen kullanıcı panonun üyesi değil.' });
    }
    if (task.assigneeIds.includes(assignUserId)) {
        const currentTask = await prisma.task.findUnique({ where: {id: taskId}, include: { assignees: { select: {id: true, name: true, avatarUrl: true }} }});
        return res.status(400).json({ msg: 'Kullanıcı zaten bu göreve atanmış.', task: currentTask });
    }


    const updatedTask = await prisma.task.update({ where: { id: taskId }, data: { assignees: { connect: { id: assignUserId } } }, include: { assignees: { select: {id: true, name: true, avatarUrl: true }} } });
    const assignedUser = await prisma.user.findUnique({ where: {id: assignUserId}, select: {name: true}});
    const requestingUser = await prisma.user.findUnique({ where: {id: requestUserId}, select: {name: true}});

    await logActivity(requestUserId, boardId, 'ASSIGN_TASK', `${assignedUser ? `"${assignedUser.name}" kullanıcısını` : 'Bir kullanıcıyı'} "${task.title}" görevine atadı`, taskId);

    // === BİLDİRİM DÜZELTMESİ ===
    if (requestUserId !== assignUserId) {
        // 1. Anlık bildirim fonksiyonunu al
        const sendRealtimeNotification = req.app.get('sendRealtimeNotification');
        // 2. Fonksiyonu 'createNotification'a ilet
        await createNotification(
            assignUserId,
            `"${requestingUser ? requestingUser.name : 'Biri'}" sizi "${task.title}" görevine atadı.`,
            boardId, 
            taskId,
            null, // commentId
            sendRealtimeNotification // Soket fonksiyonu
        );
    }
    // === BİTİŞ ===

    res.json(updatedTask);
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Atanacak kullanıcı veya görev bulunamadı.' });
      console.error("assignTask Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 5. Bir görevden kullanıcı atamasını kaldırır
exports.unassignTask = async (req, res) => {
  const { taskId } = req.params;
  const { unassignUserId } = req.body;
  const requestUserId = req.user.id;

  if (!unassignUserId) return res.status(400).json({ msg: 'Ataması kaldırılacak kullanıcı IDsi gerekli.' });
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { boardId: true } } } });
    if (!task) return res.status(404).json({ msg: 'Görev bulunamadı.' });
    const boardId = task.taskList.boardId;

    if (!await checkBoardPermission(requestUserId, boardId, 'EDITOR')) {
      return res.status(403).json({ msg: 'Görevden atama kaldırma yetkiniz yok.' });
    }

    const updatedTask = await prisma.task.update({ where: { id: taskId }, data: { assignees: { disconnect: { id: unassignUserId } } }, include: { assignees: { select: {id: true, name: true, avatarUrl: true }} } });
    const unassignedUser = await prisma.user.findUnique({ where: {id: unassignUserId}, select: {name: true}});
    await logActivity(requestUserId, boardId, 'UNASSIGN_TASK', `${unassignedUser ? `"${unassignUser.name}" kullanıcısının` : 'Bir kullanıcının'} "${task.title}" görevindeki atamasını kaldırdı`, taskId);
    res.json(updatedTask);
  } catch (err) {
     if (err.code === 'P2025') {
        console.warn(`unassignTask: Kullanıcı ${unassignUserId}, görev ${taskId} üzerinde zaten atanmamış.`);
        const currentTask = await prisma.task.findUnique({ where: {id: taskId}, include: { assignees: { select: {id: true, name: true, avatarUrl: true }} }});
        return res.json(currentTask || { msg: 'Kullanıcı zaten atanmamış.' });
     }
    console.error("unassignTask Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
   }
};

// 6. Görevi Listeler Arasında Taşıma
exports.moveTask = async (req, res) => {
  const { taskId } = req.params;
  const { newTaskListId, newOrder } = req.body;
  const userId = req.user.id;

  if (!newTaskListId) return res.status(400).json({ msg: 'Yeni Liste IDsi gerekli.' });
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskListId: true, taskList: { select: { title: true, boardId: true } } } });
    if (!task) return res.status(404).json({ msg: 'Görev bulunamadı.' });
    const boardId = task.taskList.boardId;

    if (!await checkBoardPermission(userId, boardId, 'EDITOR')) {
        return res.status(403).json({ msg: 'Görevi taşıma yetkiniz yok.' });
    }

    const targetList = await prisma.taskList.findUnique({ where: { id: newTaskListId }, select: { title: true, boardId: true } });
    if (!targetList || targetList.boardId !== boardId) return res.status(400).json({ msg: 'Geçersiz hedef liste.' });
    if (task.taskListId === newTaskListId) return res.json({ msg: 'Görev zaten hedef listede.', task });

    const dataToUpdate = { taskListId: newTaskListId };
    if (newOrder !== undefined) dataToUpdate.order = newOrder;
    const movedTask = await prisma.task.update({ where: { id: taskId }, data: dataToUpdate });
    await logActivity(userId, boardId, 'MOVE_TASK', `"${task.title}" görevini "${task.taskList.title}" listesinden "${targetList.title}" listesine taşıdı`, taskId, newTaskListId);
    res.json(movedTask);
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Görev veya liste bulunamadı.' });
      console.error("moveTask Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 7. Görev Bağımlılığı Ekleme
exports.addDependency = async (req, res) => {
    const { taskId } = req.params;
    const { dependencyTaskId, type } = req.body;
    const userId = req.user.id;

    if (!dependencyTaskId || !type || !['blocking', 'waiting_on'].includes(type)) { return res.status(400).json({ msg: 'Bağımlı görev IDsi ve tür (blocking | waiting_on) gerekli.' }); }
    if (taskId === dependencyTaskId) { return res.status(400).json({ msg: 'Bir görev kendisine bağımlı olamaz.' }); }

    try {
        const [task, depTask] = await Promise.all([
            prisma.task.findUnique({where: {id: taskId}, select: {title: true, taskList: {select: {boardId: true}}}}),
            prisma.task.findUnique({where: {id: dependencyTaskId}, select: {title: true, taskList: {select: {boardId: true}}}})
        ]);
        if (!task || !depTask) return res.status(404).json({ msg: 'Görevlerden biri bulunamadı.' });
        if (task.taskList.boardId !== depTask.taskList.boardId) { return res.status(400).json({ msg: 'Bağımlılıklar sadece aynı panodaki görevler arasında kurulabilir.' }); }
        const boardId = task.taskList.boardId;

        if (!await checkBoardPermission(userId, boardId, 'EDITOR')) { return res.status(403).json({ msg: 'Görev bağımlılığı ekleme yetkiniz yok.' }); }
        
        let dataToUpdate = {}; let logDetail;
        if (type === 'blocking') { dataToUpdate = { dependentTasks: { connect: { id: dependencyTaskId } } }; logDetail = `"${depTask.title}" görevini engelliyor olarak ayarladı`; }
        else { dataToUpdate = { blockingTasks: { connect: { id: dependencyTaskId } } }; logDetail = `"${depTask.title}" görevini bekliyor olarak ayarladı`; }

        const updatedTask = await prisma.task.update({ where: { id: taskId }, data: dataToUpdate, include: { blockingTasks: {select:{id:true, title: true}}, dependentTasks: {select:{id:true, title: true}} } });
        await logActivity(userId, boardId, 'ADD_TASK_DEPENDENCY', `"${task.title}" görevi için ${logDetail}`, taskId);
        res.json(updatedTask);
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Görevlerden biri bulunamadı.' });
        console.error("addDependency Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
       }
};

// 8. Görev Bağımlılığını Kaldırma
exports.removeDependency = async (req, res) => {
    const { taskId, dependencyTaskId } = req.params;
    const userId = req.user.id;

    try {
        const [task, depTask] = await Promise.all([
             prisma.task.findUnique({where: {id: taskId}, select: {title: true, taskList: {select: {boardId: true}}}}),
             prisma.task.findUnique({where: {id: dependencyTaskId}, select: {title: true}})
        ]);
         if (!task || !depTask) return res.status(404).json({ msg: 'Görev veya bağımlılık bulunamadı.' });
        const boardId = task.taskList.boardId;

        if (!await checkBoardPermission(userId, boardId, 'EDITOR')) { return res.status(403).json({ msg: 'Görev bağımlılığını kaldırma yetkiniz yok.' }); }

        await prisma.$transaction([
            prisma.task.update({ where: { id: taskId }, data: { blockingTasks: { disconnect: { id: dependencyTaskId } }, dependentTasks: { disconnect: { id: dependencyTaskId } } } }),
            prisma.task.update({ where: { id: dependencyTaskId }, data: { blockingTasks: { disconnect: { id: taskId } }, dependentTasks: { disconnect: { id: taskId } } } })
        ]);
        await logActivity(userId, boardId, 'REMOVE_TASK_DEPENDENCY', `"${task.title}" ve "${depTask.title}" görevleri arasındaki bağımlılığı kaldırdı`, taskId);
        res.json({ msg: 'Bağımlılık kaldırıldı.' });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Görev veya bağımlılık bulunamadı.' });
        console.error("removeDependency Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
       }
};

// 9. Görev Bağımlılıklarını Getirme
exports.getDependencies = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;
    try {
        if (!await checkTaskBasicAccess(userId, taskId)) return res.status(403).json({ msg: 'Yetkiniz yok.' });

        const dependencies = await prisma.task.findUnique({
            where: { id: taskId },
            select: { blockingTasks: { select: { id: true, title: true } }, dependentTasks: { select: { id: true, title: true } } }
        });
        if (!dependencies) return res.status(404).json({ msg: 'Görev bulunamadı.' });
        res.json(dependencies);
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Görev bulunamadı.' });
        console.error("getDependencies Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
       }
};