// controllers/webhook.controller.js
const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');
const { ActivityActionType } = require('@prisma/client'); // Enum değerlerini almak için

// 1. Bir Pano İçin Yeni Webhook Oluştur (Yetki: ADMIN)
exports.createWebhook = async (req, res) => {
    const { targetUrl, eventTypes, boardId } = req.body;
    const userId = req.user.id; // Oluşturan kullanıcı

    // Doğrulamalar
    if (!targetUrl || !boardId || !Array.isArray(eventTypes) || eventTypes.length === 0) {
        return res.status(400).json({ msg: 'Hedef URL (targetUrl), Pano ID (boardId) ve en az bir olay türü (eventTypes dizisi) gereklidir.' });
    }
    // Basit URL format kontrolü
    try { new URL(targetUrl); } catch (_) { return res.status(400).json({ msg: 'Geçersiz hedef URL formatı.' }); }
    // Olay türleri geçerli mi?
    const validEventTypes = Object.values(ActivityActionType);
    if (eventTypes.some(et => !validEventTypes.includes(et))) {
         return res.status(400).json({ msg: 'Geçersiz olay türü (eventTypes) belirtildi.' });
    }


    try {
        // Güvenlik: İşlemi yapan kişi ADMIN mi?
        const userRole = await getUserRoleInBoard(userId, boardId);
        if (!hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu panoda webhook oluşturma yetkiniz yok (Admin değilsiniz).' });
        }

        // Webhook'u oluştur
        const newWebhook = await prisma.webhook.create({
            data: {
                targetUrl,
                eventTypes, // ['CREATE_TASK', 'ADD_TASK_COMMENT'] gibi
                boardId,
                createdById: userId,
                isActive: true, // Varsayılan olarak aktif
            }
        });

        res.status(201).json(newWebhook);

    } catch (err) {
        console.error("createWebhook Hatası:", err.message);
        if (err.code === 'P2003' || err.code === 'P2025') return res.status(404).json({ msg: 'İlişkili pano bulunamadı.' });
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Bir Panonun Webhook'larını Listele (Yetki: ADMIN)
exports.getWebhooksForBoard = async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id;

    try {
        // Güvenlik: İşlemi yapan kişi ADMIN mi?
        const userRole = await getUserRoleInBoard(userId, boardId);
        if (!hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu panonun webhooklarını görme yetkiniz yok.' });
        }

        const webhooks = await prisma.webhook.findMany({
            where: { boardId: boardId },
            orderBy: { createdAt: 'desc' }
            // createdBy bilgisini dahil etmeye gerek olmayabilir
        });

        res.json(webhooks);

    } catch (err) {
        console.error("getWebhooksForBoard Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Bir Webhook'u Sil (Yetki: ADMIN)
exports.deleteWebhook = async (req, res) => {
    const { webhookId } = req.params;
    const userId = req.user.id;

    try {
        // Güvenlik: Webhook'u bul ve panosunu öğren
        const webhook = await prisma.webhook.findUnique({
            where: { id: webhookId },
            select: { boardId: true }
        });
        if (!webhook) return res.status(404).json({ msg: 'Webhook bulunamadı.' });

        // İşlemi yapan kişi o panoda ADMIN mi?
        const userRole = await getUserRoleInBoard(userId, webhook.boardId);
        if (!hasRequiredRole('ADMIN', userRole)) {
            return res.status(403).json({ msg: 'Bu webhooku silme yetkiniz yok.' });
        }

        // Webhook'u sil
        await prisma.webhook.delete({
            where: { id: webhookId }
        });

        res.json({ msg: 'Webhook başarıyla silindi.' });

    } catch (err) {
         if (err.code === 'P2025') return res.status(404).json({ msg: 'Webhook bulunamadı.' });
        console.error("deleteWebhook Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// (Opsiyonel: Webhook'u Aktif/Pasif yapma endpoint'i eklenebilir)
// exports.toggleWebhookStatus = async (req, res) => { ... }