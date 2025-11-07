// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/controllers/timeEntry.controller.js
const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notifications');

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
const checkTaskPermission = async (userId, taskId, requiredRole = 'MEMBER') => {
  if (!userId || !taskId) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { taskList: { select: { boardId: true } } },
    });
    if (!task) return false;
    const userRole = await getUserRoleInBoard(userId, task.taskList.boardId);
    return hasRequiredRole(requiredRole, userRole);
  } catch (error) {
    console.error(`checkTaskPermission error for task ${taskId}:`, error);
    return false;
  }
};
// --- BİTİŞ ---


// 1. Bir Görev İçin Zamanlayıcı Başlatma
exports.startTimeEntry = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id; 

    try {
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu görev için zaman kaydı başlatma yetkiniz yok.' });
        }
        const runningEntry = await prisma.timeEntry.findFirst({
            where: { taskId: taskId, userId: userId, endTime: null }
        });
        if (runningEntry) {
            return res.status(400).json({ msg: 'Bu görev için zaten çalışan bir zamanlayıcınız var.', entry: runningEntry });
        }

        const newEntry = await prisma.timeEntry.create({
            data: {
                startTime: new Date(),
                taskId: taskId,
                userId: userId,
                endTime: null,
                duration: null 
            }
        });
        
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { boardId: true }}}});
        if (task) {
            await logActivity(userId, task.taskList.boardId, 'START_TIME_ENTRY', `"${task.title}" görevi için zamanlayıcıyı başlattı`, taskId);
        }

        res.status(201).json(newEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Görev bulunamadı.' });
        console.error("startTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Bir Görev İçin Zamanlayıcı Durdurma
exports.stopTimeEntry = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { notes } = req.body; 

    try {
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu görev için zaman kaydı durdurma yetkiniz yok.' });
        }

        const runningEntry = await prisma.timeEntry.findFirst({
            where: { taskId: taskId, userId: userId, endTime: null },
            orderBy: { startTime: 'desc' }
        });

        if (!runningEntry) {
            return res.status(404).json({ msg: 'Bu görev için çalışan bir zamanlayıcı bulunamadı.' });
        }

        const endTime = new Date();
        const durationMs = endTime.getTime() - runningEntry.startTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60)); 

        const stoppedEntry = await prisma.timeEntry.update({
            where: { id: runningEntry.id },
            data: {
                endTime: endTime,
                duration: durationMinutes,
                notes: notes || runningEntry.notes 
            }
        });
        
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, taskList: { select: { boardId: true }}}});
        if (task) {
            const durationStr = durationMinutes > 0 ? ` (${durationMinutes} dakika)` : '';
            await logActivity(userId, task.taskList.boardId, 'STOP_TIME_ENTRY', `"${task.title}" görevi için zamanlayıcıyı durdurdu${durationStr}`, taskId);
        }

        res.json(stoppedEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Durdurulacak zaman kaydı bulunamadı.' });
        console.error("stopTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Manuel Zaman Girişi Ekleme (BİLDİRİM EKLENDİ)
exports.addManualTimeEntry = async (req, res) => {
    const { taskId } = req.params;
    const { durationInMinutes, date, notes } = req.body;
    const userId = req.user.id;

    if (!durationInMinutes || typeof durationInMinutes !== 'number' || durationInMinutes <= 0) {
        return res.status(400).json({ msg: 'Geçerli bir süre (durationInMinutes) gereklidir.' });
    }
    if (!date) {
        return res.status(400).json({ msg: 'Tarih (date) gereklidir (YYYY-MM-DD formatında).' });
    }

    let startTime;
    try {
        startTime = new Date(date + 'T00:00:00.000Z'); 
        if (isNaN(startTime.getTime())) throw new Error();
    } catch (e) {
        return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' });
    }
    const endTime = new Date(startTime.getTime() + durationInMinutes * 60000);

    try {
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu göreve zaman kaydı ekleme yetkiniz yok.' });
        }
        
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { 
                title: true, 
                taskList: { select: { boardId: true }}, 
                createdById: true, 
                assigneeIds: true 
            }
        });
        if (!task) return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
        const boardId = task.taskList.boardId;

        const manualEntry = await prisma.timeEntry.create({
            data: {
                startTime: startTime,
                endTime: endTime, 
                duration: Math.round(durationInMinutes), 
                notes: notes || null,
                taskId: taskId,
                userId: userId,
            },
            // YENİ: Dönen veriye 'user'ı ekle (Arayüzde anlık güncelleme için)
            include: { user: { select: { id: true, name: true, avatarUrl: true } } }
        });
        
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true }});
        const durationStr = `${durationInMinutes} dakika`;
        const message = `"${user ? user.name : 'Biri'}" "${task.title}" görevine manuel olarak ${durationStr} ekledi.`;
        
        await logActivity(userId, boardId, 'ADD_TIME_ENTRY', message, taskId);
        
        const recipients = new Set([task.createdById, ...task.assigneeIds]);
        recipients.delete(userId); 
        recipients.delete(null);

        for (const recipientId of recipients) {
            if (recipientId) {
                await createNotification(recipientId, message, boardId, taskId);
            }
        }
        res.status(201).json(manualEntry);

    } catch (err) {
        if (err.code === 'P2003' || err.code === 'P2025') return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
        console.error("addManualTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 4. Bir Görevin Zaman Kayıtlarını Listeleme
exports.getTimeEntriesForTask = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 25 } = req.query; 
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    try {
        if (!await checkTaskPermission(userId, taskId, 'VIEWER')) {
            return res.status(403).json({ msg: 'Bu görevin zaman kayıtlarını görme yetkiniz yok.' });
        }

        const entries = await prisma.timeEntry.findMany({
            where: { taskId: taskId },
            orderBy: { startTime: 'desc' }, 
            skip: skip,
            take: limitNum,
            include: { 
                user: { select: { id: true, name: true, avatarUrl: true } }
            }
        });

        const totalEntries = await prisma.timeEntry.count({ where: { taskId: taskId }});

        res.json({
            entries,
            totalEntries,
            currentPage: pageNum,
            totalPages: Math.ceil(totalEntries / limitNum)
        });

    } catch (err) {
        console.error("getTimeEntriesForTask Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 5. Kullanıcının Belirli Aralıktaki Zaman Kayıtlarını Getirme
exports.getTimeEntriesForUser = async (req, res) => {
    // ... (Bu fonksiyon aynı kalır, frontend'de şu an kullanılmıyor)
    const userId = req.user.id; 
    const { start, end, page = 1, limit = 25 } = req.query; 
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const whereClause = { userId: userId };
    try {
        if (start) {
            whereClause.startTime = { ...whereClause.startTime, gte: new Date(start + 'T00:00:00.000Z') };
        }
        if (end) {
            whereClause.startTime = { ...whereClause.startTime, lte: new Date(end + 'T23:59:59.999Z') };
        }
    } catch(e) {
         return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' });
    }
    try {
        const entries = await prisma.timeEntry.findMany({
            where: whereClause,
            orderBy: { startTime: 'desc' },
            skip: skip,
            take: limitNum,
            include: { 
                task: { select: { id: true, title: true } }
            }
        });
        const totalEntries = await prisma.timeEntry.count({ where: whereClause });
        res.json({
            entries,
            totalEntries,
            currentPage: pageNum,
            totalPages: Math.ceil(totalEntries / limitNum)
        });
    } catch (err) {
        console.error("getTimeEntriesForUser Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 6. YENİ: Zaman Girişini Güncelleme (Düzenleme)
exports.updateTimeEntry = async (req, res) => {
    const { entryId } = req.params;
    const { durationInMinutes, date, notes } = req.body;
    const userId = req.user.id;

    try {
        const entry = await prisma.timeEntry.findUnique({
            where: { id: entryId },
            select: { userId: true, taskId: true, startTime: true, endTime: true, task: { select: { title: true, taskList: { select: { boardId: true }} } } }
        });

        if (!entry) return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        if (!entry.task || !entry.task.taskList) return res.status(404).json({ msg: 'İlişkili görev/pano bulunamadı.' });

        // Güvenlik: Sadece kaydı giren kişi veya Pano Admini düzenleyebilir
        const userRole = await getUserRoleInBoard(userId, entry.task.taskList.boardId);
        if (entry.userId !== userId && !hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu zaman kaydını düzenleme yetkiniz yok.' });
        }
        
        // Sadece manuel girilmiş (durdurulmuş) kayıtlar düzenlenebilir
        if (entry.endTime === null) {
            return res.status(400).json({ msg: 'Çalışan bir zamanlayıcıyı düzenleyemezsiniz. Önce durdurun.' });
        }

        const dataToUpdate = {};
        let newStartTime = entry.startTime;
        
        if (date) {
             try {
                newStartTime = new Date(date + 'T00:00:00.000Z');
                if (isNaN(newStartTime.getTime())) throw new Error();
                dataToUpdate.startTime = newStartTime;
             } catch (e) {
                return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' });
             }
        }
        if (durationInMinutes) {
            dataToUpdate.duration = Math.round(durationInMinutes);
            dataToUpdate.endTime = new Date(newStartTime.getTime() + dataToUpdate.duration * 60000);
        }
        if (notes !== undefined) {
            dataToUpdate.notes = notes || null;
        }

        const updatedEntry = await prisma.timeEntry.update({
            where: { id: entryId },
            data: dataToUpdate,
            include: { user: { select: { id: true, name: true, avatarUrl: true } } }
        });

        res.json(updatedEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        console.error("updateTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 7. YENİ: Zaman Girişini Silme
exports.deleteTimeEntry = async (req, res) => {
    const { entryId } = req.params;
    const userId = req.user.id;

    try {
        const entry = await prisma.timeEntry.findUnique({
            where: { id: entryId },
            select: { userId: true, taskId: true, task: { select: { title: true, taskList: { select: { boardId: true }} } } }
        });

        if (!entry) return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        if (!entry.task || !entry.task.taskList) return res.status(404).json({ msg: 'İlişkili görev/pano bulunamadı.' });

        // Güvenlik: Sadece kaydı giren kişi veya Pano Admini silebilir
        const userRole = await getUserRoleInBoard(userId, entry.task.taskList.boardId);
        if (entry.userId !== userId && !hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu zaman kaydını silme yetkiniz yok.' });
        }

        await prisma.timeEntry.delete({ where: { id: entryId } });
        
        await logActivity(userId, entry.task.taskList.boardId, 'DELETE_TIME_ENTRY', `"${entry.task.title}" görevinden bir zaman kaydını sildi`, entry.taskId);

        res.json({ msg: 'Zaman kaydı silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        console.error("deleteTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};