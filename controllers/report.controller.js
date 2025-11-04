// controllers/report.controller.js
const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');

// Pano Bazlı Raporlar
exports.getBoardReports = async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;
    const { reportType, startDate, endDate } = req.query;

    try {
        // Güvenlik: Kullanıcının rolünü al (Raporlar için en az EDITOR?)
        const userRole = await getUserRoleInBoard(userId, boardId);
        if (!hasRequiredRole('EDITOR', userRole)) {
            return res.status(403).json({ msg: 'Bu pano için raporları görme yetkiniz yok.' });
        }

        // Tarih filtresi koşulu
        const dateFilter = {};
        // Tarih formatını doğrula
        try {
            if (startDate) dateFilter.gte = new Date(startDate + 'T00:00:00.000Z');
            if (endDate) dateFilter.lte = new Date(endDate + 'T23:59:59.999Z');
            // Gelen tarihlerin geçerli olup olmadığını basitçe kontrol et
            if (startDate && isNaN(dateFilter.gte.getTime())) throw new Error('Invalid start date');
            if (endDate && isNaN(dateFilter.lte.getTime())) throw new Error('Invalid end date');
        } catch (dateError) {
             return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
        }
        const hasDateFilter = startDate || endDate;

        let reportData = {};

        // Rapor Tipine Göre Hesaplama
        switch (reportType) {
            case 'completion':
                const completionStats = await prisma.task.groupBy({
                    by: ['approvalStatus'],
                    where: {
                        taskList: { boardId: boardId },
                        ...(hasDateFilter && { createdAt: dateFilter })
                    },
                    _count: { id: true },
                });
                reportData = completionStats.map(s => ({ status: s.approvalStatus, count: s._count.id }));
                break;

            case 'overdue':
                 const now = new Date();
                 const overdueCount = await prisma.task.count({
                     where: {
                         taskList: { boardId: boardId },
                         dueDate: { lt: now },
                         approvalStatus: { notIn: ['APPROVED', 'RESOLVED', 'CLOSED'] } // Şemada CLOSED yok ama mantıken eklenebilir
                     }
                 });
                 reportData = { overdueCount };
                 break;

            case 'memberPerformance':
                 // Bu raporlama daha karmaşık Prisma aggregate işlemleri gerektirebilir.
                 // Şimdilik basit bir örnek bırakalım veya daha sonra detaylandıralım.
                 reportData = { message: "Üye performansı raporu henüz tam olarak implemente edilmedi." };
                 // const memberStats = await prisma.task.groupBy({ ... });
                 // reportData = memberStats;
                 break;

            default:
                return res.status(400).json({ msg: 'Geçersiz rapor tipi (reportType). Örn: completion, overdue, memberPerformance' });
        }

        res.json({ reportType, data: reportData });

    } catch (err) {
        console.error(`getBoardReports Hatası (Board: ${boardId}, Type: ${reportType}):`, err.message);
        // Prisma ile ilgili spesifik hatalar yakalanabilir
        if (err.code === 'P2021' || err.code === 'P2025') { // Örnek Prisma hata kodları
            return res.status(404).json({ msg: 'İlişkili veri bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};

// Kullanıcı Bazlı Raporlar
exports.getUserReports = async (req, res) => {
    const { userId } = req.params; // Raporu istenen kullanıcı
    const requestUserId = req.user.id; // Raporu isteyen admin/kullanıcı
    const { startDate, endDate } = req.query;

    try {
        // Güvenlik: Raporu isteyen kişi ADMIN mi VEYA kendi raporunu mu istiyor?
        const requestUser = await prisma.user.findUnique({where: {id: requestUserId}, select: {role: true}});
        if (!requestUser) { // İstek yapan kullanıcı bulunamadı (auth middleware geçse bile)
             return res.status(401).json({ msg: 'Yetkisiz.' });
        }
        if (requestUserId !== userId && requestUser.role !== 'ADMIN') {
             return res.status(403).json({ msg: 'Bu kullanıcının raporlarını görme yetkiniz yok.' });
        }

        // Tarih filtresi
        const dateFilter = {};
        // Tarih formatını doğrula
        try {
            if (startDate) dateFilter.gte = new Date(startDate + 'T00:00:00.000Z');
            if (endDate) dateFilter.lte = new Date(endDate + 'T23:59:59.999Z');
            if (startDate && isNaN(dateFilter.gte.getTime())) throw new Error('Invalid start date');
            if (endDate && isNaN(dateFilter.lte.getTime())) throw new Error('Invalid end date');
        } catch (dateError) {
             return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
        }
        const hasDateFilter = startDate || endDate;

        // 1. Zaman Kayıtları Özeti
        const timeEntriesSummary = await prisma.timeEntry.aggregate({
            _sum: { duration: true },
            _count: { id: true },
            where: {
                userId: userId,
                ...(hasDateFilter && { startTime: dateFilter })
            }
        });

        // 2. Tamamlanan Görev Sayısı
        const completedTasksCount = await prisma.task.count({
            where: {
                assigneeIds: { has: userId },
                approvalStatus: 'APPROVED', // Veya RESOLVED? Durumlarınıza göre ayarlayın
                 ...(hasDateFilter && { updatedAt: dateFilter }) // Tamamlanma tarihine göre (updatedAt varsayımı)
            }
        });

        res.json({
            userId: userId,
            timeEntries: {
                totalMinutes: timeEntriesSummary._sum.duration || 0,
                entryCount: timeEntriesSummary._count.id || 0
            },
            completedTasks: completedTasksCount
        });

    } catch (err) {
        console.error(`getUserReports Hatası (User: ${userId}):`, err.message);
        if (err.code === 'P2025') { // İstenen kullanıcı bulunamazsa
            return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};