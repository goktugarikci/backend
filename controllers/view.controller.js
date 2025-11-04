const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
// Kullanıcının belirtilen panolara erişimi olup olmadığını kontrol eder (En az VIEWER)
const checkMultipleBoardAccess = async (userId, boardIds) => {
    if (!boardIds || boardIds.length === 0) return true; // Pano belirtilmemişse, erişim var varsayılır (genel görevler için)
    try {
        const memberships = await prisma.boardMembership.findMany({
            where: { userId: userId, boardId: { in: boardIds } },
            select: { boardId: true } // Sadece ID'leri çekmek yeterli
        });
        // İstenen tüm panolar, kullanıcının üye olduğu panolar listesinde var mı?
        const memberBoardIds = memberships.map(m => m.boardId);
        return boardIds.every(reqId => memberBoardIds.includes(reqId));
    } catch (error) {
        console.error("checkMultipleBoardAccess Error:", error);
        return false; // Hata durumunda erişim yok varsayalım
    }
};
// --- BİTİŞ ---


// Takvim Görünümü İçin Veri Getirme
exports.getCalendarData = async (req, res) => {
    const userId = req.user.id;
    let { boardIds, startDate, endDate } = req.query; // boardIds[]=id1&boardIds[]=id2

    // boardIds'i diziye çevir
    if (boardIds && !Array.isArray(boardIds)) boardIds = [boardIds];
    if (boardIds?.length === 0) boardIds = undefined; // Boş dizi ise filtreleme yapma

    if (!startDate || !endDate) {
        return res.status(400).json({ msg: 'Başlangıç (startDate) ve Bitiş (endDate) tarihleri (YYYY-MM-DD) gereklidir.' });
    }

    let start, end;
    try {
        start = new Date(startDate + 'T00:00:00.000Z');
        end = new Date(endDate + 'T23:59:59.999Z');
        if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Invalid date');
    } catch (e) {
        return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
    }

    try {
        // Güvenlik: İstenen panolara erişim var mı? (En az VIEWER)
        if (boardIds && !(await checkMultipleBoardAccess(userId, boardIds))) {
             return res.status(403).json({ msg: 'Belirtilen panolardan bazılarına erişim yetkiniz yok.' });
        }

        // Hem Görevleri hem de Alt Görevleri çek (dueDate'e göre)
        const taskWhere = {
            dueDate: { gte: start, lte: end },
            ...(boardIds && { taskList: { boardId: { in: boardIds } } })
        };
        const itemWhere = {
            dueDate: { gte: start, lte: end },
            ...(boardIds && { task: { taskList: { boardId: { in: boardIds } } } })
        };

        // Veritabanı sorgularını aynı anda çalıştır
        const [tasks, checklistItems] = await prisma.$transaction([
            prisma.task.findMany({
                where: taskWhere,
                select: { id: true, title: true, dueDate: true, priority: true, taskList: { select: { boardId: true, board: { select: { name: true }} } } }
            }),
            prisma.checklistItem.findMany({
                where: itemWhere,
                select: { id: true, text: true, dueDate: true, isCompleted: true, task: { select: { id: true, title: true, taskList: { select: { boardId: true, board: { select: { name: true }} } } } } }
            })
        ]);

        // Veriyi takvim formatına dönüştür
        const calendarEvents = [
            ...tasks.map(task => ({
                id: `task-${task.id}`,
                title: task.title,
                start: task.dueDate,
                end: task.dueDate,
                allDay: true,
                resource: { type: 'task', priority: task.priority, boardName: task.taskList?.board?.name, boardId: task.taskList?.boardId }
            })),
            ...checklistItems.map(item => ({
                 id: `item-${item.id}`,
                 title: item.text,
                 start: item.dueDate,
                 end: item.dueDate,
                 allDay: true,
                 resource: { type: 'checklistitem', isCompleted: item.isCompleted, taskTitle: item.task?.title, taskId: item.task?.id, boardName: item.task?.taskList?.board?.name, boardId: item.task?.taskList?.boardId }
            }))
        ];

        res.json(calendarEvents);

    } catch (err) {
        console.error("getCalendarData Hatası:", err.message);
        // Prisma ile ilgili spesifik hatalar yakalanabilir
        if (err.code?.startsWith('P')) { // Prisma hata kodları genellikle P ile başlar
             return res.status(500).json({ msg: 'Veritabanı sorgusu sırasında bir hata oluştu.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};

// Zaman Çizelgesi / Gantt Verisi Getirme
exports.getTimelineData = async (req, res) => {
     const userId = req.user.id;
     let { boardIds, startDate, endDate } = req.query;

     if (boardIds && !Array.isArray(boardIds)) boardIds = [boardIds];
     if (boardIds?.length === 0) boardIds = undefined;

     let start, end;
     try {
        if(startDate) start = new Date(startDate + 'T00:00:00.000Z');
        if(endDate) end = new Date(endDate + 'T23:59:59.999Z');
        if (startDate && isNaN(start.getTime())) throw new Error('Invalid start date');
        if (endDate && isNaN(end.getTime())) throw new Error('Invalid end date');
     } catch (e) {
         return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
     }

     try {
        // Güvenlik: İstenen panolara erişim var mı? (En az VIEWER)
        if (boardIds && !(await checkMultipleBoardAccess(userId, boardIds))) {
             return res.status(403).json({ msg: 'Belirtilen panolardan bazılarına erişim yetkiniz yok.' });
        }

        // Görevleri çek (Sadece startDate veya dueDate'i olanları)
        const whereClause = {
            OR: [ { startDate: { not: null } }, { dueDate: { not: null } } ],
             ...(boardIds && { taskList: { boardId: { in: boardIds } } })
        };
        // Tarih aralığı filtresi
        if (start) whereClause.dueDate = { ...whereClause.dueDate, gte: start }; // Bitişi başlangıçtan sonra olmalı
        if (end) whereClause.startDate = { ...whereClause.startDate, lte: end }; // Başlangıcı bitişten önce olmalı

        const tasks = await prisma.task.findMany({
            where: whereClause,
            select: {
                id: true, title: true, startDate: true, dueDate: true, priority: true, assigneeIds: true,
                blockingTaskIds: true, // Neleri bekliyor
                dependentTaskIds: true, // Neleri engelliyor
                taskList: { select: { id: true, title: true, boardId: true } }
            },
            orderBy: { startDate: 'asc' } // Başlangıç tarihine göre sırala
        });

        // Gantt formatına dönüştür
        const ganttTasks = tasks.map(task => ({
            id: task.id,
            text: task.title,
            start_date: task.startDate, // Gantt kütüphanesi bu field'ı bekleyebilir
            end_date: task.dueDate,
            progress: 0, // Bu değerin hesaplanması gerekir (örn: checklist'ten)
            priority: task.priority, // Ekstra bilgi
            // duration: calculateDuration(task.startDate, task.dueDate), // Gerekirse süre hesapla
        }));

        // Linkleri (Bağımlılıkları) oluştur
        const ganttLinks = [];
        const taskIdsInView = new Set(ganttTasks.map(t => t.id));
        tasks.forEach(task => {
            // Bu görev neleri bekliyor? (blockingTasks) -> Link: Blocker -> Task
            task.blockingTaskIds.forEach(blockerId => {
                if (taskIdsInView.has(blockerId)) { // Eğer engelleyen görev de görünümdeyse
                    ganttLinks.push({
                        id: `${blockerId}-${task.id}`, // Benzersiz link ID
                        source: blockerId, // Engelleyen (önce bitmesi gereken)
                        target: task.id,   // Engellenen (sonra başlaması gereken)
                        type: "0"          // 0: Finish to Start (Biri bitince diğeri başlar)
                    });
                }
            });
            // Neleri engelliyor? (dependentTasks) -> Link: Task -> Dependent (Bu genellikle redundant olur, sadece source->target yeterli)
        });


        res.json({ data: ganttTasks, links: ganttLinks });

     } catch (err) {
        console.error("getTimelineData Hatası:", err.message);
        if (err.code?.startsWith('P')) {
             return res.status(500).json({ msg: 'Veritabanı sorgusu sırasında bir hata oluştu.' });
        }
        res.status(500).send('Sunucu Hatası');
     }
};