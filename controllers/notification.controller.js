// controllers/notification.controller.js
const prisma = require('../lib/prisma');

// 1. Kullanıcının Bildirimlerini Getir (Sayfalı, Okunmamış/Tümü)
exports.getNotifications = async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 10, unreadOnly = false } = req.query; // Query parametreleri
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const filterUnread = unreadOnly === 'true' || unreadOnly === true;

    try {
        const whereClause = { userId: userId };
        if (filterUnread) {
            whereClause.isRead = false; // Sadece okunmamışları filtrele
        }

        const notifications = await prisma.notification.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }, // En yeniden eskiye
            skip: skip,
            take: limitNum,
            include: { // İlgili nesnelerin temel bilgilerini ekleyelim (link için)
                task: { select: { id: true, title: true } },
                board: { select: { id: true, name: true } },
                comment: { select: { id: true } } // Yorumun ID'si yeterli olabilir
            }
        });

        // Toplam bildirim sayısı (filtrelenmiş)
        const totalNotifications = await prisma.notification.count({ where: whereClause });

        res.json({
            notifications,
            totalNotifications,
            currentPage: pageNum,
            totalPages: Math.ceil(totalNotifications / limitNum)
        });

    } catch (err) {
        console.error("getNotifications Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Tek Bir Bildirimi Okundu Olarak İşaretle
exports.markAsRead = async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user.id;

    try {
        // updateMany kullanarak sadece kullanıcının kendi bildirimini güncellediğinden emin ol
        const updateResult = await prisma.notification.updateMany({
            where: {
                id: notificationId,
                userId: userId // Sadece kendi bildirimini işaretleyebilir
            },
            data: { isRead: true }
        });

        if (updateResult.count === 0) {
            // Ya bildirim yok ya da başkasına ait
            return res.status(404).json({ msg: 'Bildirim bulunamadı veya size ait değil.' });
        }

        res.json({ msg: 'Bildirim okundu olarak işaretlendi.' });

    } catch (err) {
        console.error("markAsRead Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Tüm Bildirimleri Okundu Olarak İşaretle
exports.markAllAsRead = async (req, res) => {
    const userId = req.user.id;

    try {
        // Kullanıcının tüm okunmamış bildirimlerini güncelle
        const updateResult = await prisma.notification.updateMany({
            where: {
                userId: userId,
                isRead: false // Sadece okunmamış olanları
            },
            data: { isRead: true }
        });

        res.json({ msg: `${updateResult.count} bildirim okundu olarak işaretlendi.` });

    } catch (err) {
        console.error("markAllAsRead Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};