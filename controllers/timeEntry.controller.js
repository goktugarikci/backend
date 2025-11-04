const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization'); // Yetkilendirme

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
// Kullanıcının bir Görev üzerinde (belirtilen minimum rolle) yetkisi olup olmadığını kontrol eder
const checkTaskPermission = async (userId, taskId, requiredRole = 'MEMBER') => { // Zaman takibi için en az MEMBER olmalı
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
    const userId = req.user.id; // Giriş yapmış kullanıcı

    try {
        // Güvenlik: Kullanıcı bu görev için zaman kaydı başlatabilir mi? (MEMBER rolü)
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu görev için zaman kaydı başlatma yetkiniz yok.' });
        }

        // Güvenlik: Kullanıcının bu görev için zaten çalışan bir zamanlayıcısı var mı?
        const runningEntry = await prisma.timeEntry.findFirst({
            where: {
                taskId: taskId,
                userId: userId,
                endTime: null // Bitiş zamanı olmayan kayıtları bul
            }
        });
        if (runningEntry) {
            return res.status(400).json({ msg: 'Bu görev için zaten çalışan bir zamanlayıcınız var.', entry: runningEntry });
        }

        // Yeni zaman kaydını başlat
        const newEntry = await prisma.timeEntry.create({
            data: {
                startTime: new Date(), // Şu anki zaman
                taskId: taskId,
                userId: userId,
                endTime: null, // Henüz bitmedi
                duration: null // Henüz hesaplanmadı
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
    const { notes } = req.body; // Opsiyonel notlar

    try {
        // Güvenlik: Kullanıcı bu göreve erişebilir mi? (MEMBER rolü)
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu görev için zaman kaydı durdurma yetkiniz yok.' });
        }

        // Durdurulacak (çalışan) zaman kaydını bul (en sonuncusu)
        const runningEntry = await prisma.timeEntry.findFirst({
            where: {
                taskId: taskId,
                userId: userId,
                endTime: null
            },
            orderBy: { startTime: 'desc' } // Birden fazla varsa en sonuncusunu al
        });

        if (!runningEntry) {
            return res.status(404).json({ msg: 'Bu görev için çalışan bir zamanlayıcı bulunamadı.' });
        }

        // Bitiş zamanını ve süreyi hesapla
        const endTime = new Date();
        const durationMs = endTime.getTime() - runningEntry.startTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60)); // Dakikaya yuvarla

        // Zaman kaydını güncelle
        const stoppedEntry = await prisma.timeEntry.update({
            where: { id: runningEntry.id },
            data: {
                endTime: endTime,
                duration: durationMinutes,
                notes: notes || runningEntry.notes // Yeni not varsa güncelle, yoksa eskisini koru
            }
        });

        res.json(stoppedEntry);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Durdurulacak zaman kaydı bulunamadı.' });
        console.error("stopTimeEntry Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Manuel Zaman Girişi Ekleme
exports.addManualTimeEntry = async (req, res) => {
    const { taskId } = req.params;
    const { durationInMinutes, date, notes } = req.body;
    const userId = req.user.id;

    // Doğrulamalar
    if (!durationInMinutes || typeof durationInMinutes !== 'number' || durationInMinutes <= 0) {
        return res.status(400).json({ msg: 'Geçerli bir süre (durationInMinutes) gereklidir.' });
    }
    if (!date) {
        return res.status(400).json({ msg: 'Tarih (date) gereklidir (YYYY-MM-DD formatında).' });
    }

    let startTime;
    try {
        startTime = new Date(date + 'T00:00:00.000Z'); // Tarihi günün başlangıcı olarak al
        if (isNaN(startTime.getTime())) throw new Error(); // Geçersiz tarih kontrolü
    } catch (e) {
        return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' });
    }
    // Bitiş zamanını hesapla (sadece DB'de tutarlılık için, zorunlu değil)
    const endTime = new Date(startTime.getTime() + durationInMinutes * 60000);

    try {
        // Güvenlik: Kullanıcı bu göreve zaman ekleyebilir mi? (MEMBER rolü)
        if (!await checkTaskPermission(userId, taskId, 'MEMBER')) {
            return res.status(403).json({ msg: 'Bu göreve zaman kaydı ekleme yetkiniz yok.' });
        }

        // Manuel girişi oluştur
        const manualEntry = await prisma.timeEntry.create({
            data: {
                startTime: startTime,
                endTime: endTime, // Hesaplanan bitiş
                duration: Math.round(durationInMinutes), // Gelen süreyi kaydet
                notes: notes || null,
                taskId: taskId,
                userId: userId,
            }
        });

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
    const { page = 1, limit = 25 } = req.query; // Sayfalama
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    try {
        // Güvenlik: Kullanıcı bu görevin zaman kayıtlarını görebilir mi? (VIEWER rolü yeterli)
        if (!await checkTaskPermission(userId, taskId, 'VIEWER')) {
            return res.status(403).json({ msg: 'Bu görevin zaman kayıtlarını görme yetkiniz yok.' });
        }

        const entries = await prisma.timeEntry.findMany({
            where: { taskId: taskId },
            orderBy: { startTime: 'desc' }, // En yeniden eskiye
            skip: skip,
            take: limitNum,
            include: { // Kaydı yapan kullanıcıyı da ekleyelim
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
    const userId = req.user.id; // Sadece kendi kayıtlarını getirebilir
    const { start, end, page = 1, limit = 25 } = req.query; // Tarih aralığı ve sayfalama
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const whereClause = { userId: userId };
    try {
        // Tarih filtresini ekle
        if (start) {
            whereClause.startTime = { ...whereClause.startTime, gte: new Date(start + 'T00:00:00.000Z') };
        }
        if (end) {
            // Bitiş tarihi için endTime veya startTime'ı kullanabiliriz.
            // Genellikle startTime'a göre filtrelemek daha mantıklı.
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
            include: { // İlişkili görevi de ekleyelim
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