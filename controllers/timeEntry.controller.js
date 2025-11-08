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
            where: {
                taskId: taskId,
                userId: userId,
                endTime: null 
            }
        });

        // DÜZELTME (image_771db1.png): Frontend 'TimeEntryWithUser' bekliyor.
        // Eğer zaten çalışıyorsa, 'user' bilgisiyle birlikte döndür.
        if (runningEntry) {
            const entryWithUser = await prisma.timeEntry.findUnique({
                where: { id: runningEntry.id },
                include: { user: { select: { id: true, name: true, avatarUrl: true }}}
            });
            return res.status(200).json(entryWithUser);
        }

        const newEntry = await prisma.timeEntry.create({
            data: {
                startTime: new Date(), 
                taskId: taskId,
                userId: userId,
                endTime: null, 
                duration: null 
            },
            // DÜZELTME (image_771db1.png): 'user' objesini yanıta dahil et
            include: { 
                user: { select: { id: true, name: true, avatarUrl: true } }
            }
        });

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
            where: {
                taskId: taskId,
                userId: userId,
                endTime: null
            },
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
            },
            // DÜZELTME (image_771db1.png): 'user' objesini yanıta dahil et
            include: { 
                user: { select: { id: true, name: true, avatarUrl: true } }
            }
        });

        res.json(stoppedEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Durdurulacak zaman kaydı bulunamadı.' });
        console.error("stopTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Manuel Zaman Girişi Ekleme (BİLDİRİM DÜZELTMESİ)
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
            // DÜZELTME (image_771db1.png): 'user' objesini yanıta dahil et
            include: { 
                user: { select: { id: true, name: true, avatarUrl: true } }
            }
        });
        
        // Loglama ve Bildirim
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true }});
        const durationStr = `${durationInMinutes} dakika`;
        const message = `"${user ? user.name : 'Biri'}" "${task.title}" görevine manuel olarak ${durationStr} ekledi.`;
        
        await logActivity(userId, boardId, 'ADD_TIME_ENTRY', message, taskId);
        
        const recipients = new Set([task.createdById, ...task.assigneeIds]);
        recipients.delete(userId); 
        recipients.delete(null);
        
        // === DÜZELTME: Anlık Bildirim Gönder ===
        const sendRealtimeNotification = req.app.get('sendRealtimeNotification');

        for (const recipientId of recipients) {
            if (recipientId) {
                // 'utils/notifications.js'deki createNotification'a socket fonksiyonunu iletiyoruz
                await createNotification(
                    recipientId, 
                    message, 
                    boardId, 
                    taskId, 
                    null, // commentId
                    sendRealtimeNotification // Soket fonksiyonu
                );
            }
        }
        // === BİTİŞ ===

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
    const userId = req.user.id; 
    const { startDate, endDate, page = 1, limit = 25 } = req.query; 
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const whereClause = { userId: userId };
    try {
        if (startDate) {
            whereClause.startTime = { ...whereClause.startTime, gte: new Date(startDate + 'T00:00:00.000Z') };
        }
        if (endDate) {
            whereClause.startTime = { ...whereClause.startTime, lte: new Date(endDate + 'T23:59:59.999Z') };
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

// 6. Zaman Girişini Güncelleme
exports.updateTimeEntry = async (req, res) => {
    const { entryId } = req.params;
    const { durationInMinutes, date, notes } = req.body;
    const userId = req.user.id;

    if (durationInMinutes === undefined && date === undefined && notes === undefined) {
         return res.status(400).json({ msg: 'Güncellenecek en az bir alan gereklidir.' });
    }

    try {
        const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });

        // Güvenlik: Sadece kaydı oluşturan kişi veya bir ADMIN mi?
        // DÜZELTME: 'entry.taskId' olmalı (entry.boardId değil)
        const userRole = await getUserRoleInBoard(userId, entry.taskId); 
        if (entry.userId !== userId && !hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu zaman kaydını düzenleme yetkiniz yok.' });
        }

        const dataToUpdate = {};
        if (notes !== undefined) dataToUpdate.notes = notes || null;

        const newDuration = durationInMinutes !== undefined ? Math.round(durationInMinutes) : entry.duration;
        const newDateStr = date !== undefined ? date : entry.startTime.toISOString().split('T')[0];

        if (durationInMinutes !== undefined || date !== undefined) {
             if (newDuration === null || newDuration <= 0) return res.status(400).json({ msg: 'Geçerli bir süre (durationInMinutes) gereklidir.' });
             try {
                const startTime = new Date(newDateStr + 'T00:00:00.000Z');
                if (isNaN(startTime.getTime())) throw new Error('Invalid date');
                const endTime = new Date(startTime.getTime() + newDuration * 60000);
                
                dataToUpdate.startTime = startTime;
                dataToUpdate.endTime = endTime;
                dataToUpdate.duration = newDuration;
             } catch (e) {
                 return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' });
             }
        }
        
        const updatedEntry = await prisma.timeEntry.update({
            where: { id: entryId },
            data: dataToUpdate,
            // DÜZELTME (image_771db1.png): 'user' objesini yanıta dahil et
            include: { user: { select: { id: true, name: true, avatarUrl: true } } }
        });

        res.json(updatedEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        console.error("updateTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 7. Zaman Girişini Silme
exports.deleteTimeEntry = async (req, res) => {
    const { entryId } = req.params;
    const userId = req.user.id;

    try {
        const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
        if (!entry) return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });

        // Güvenlik: Sadece kaydı oluşturan kişi veya bir ADMIN mi?
        // DÜZELTME: 'entry.taskId' olmalı (entry.boardId değil)
        const userRole = await getUserRoleInBoard(userId, entry.taskId);
        if (entry.userId !== userId && !hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu zaman kaydını silme yetkiniz yok.' });
        }

        await prisma.timeEntry.delete({ where: { id: entryId } });
        res.json({ msg: 'Zaman kaydı başarıyla silindi.' });
    
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Zaman kaydı bulunamadı.' });
        console.error("deleteTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};