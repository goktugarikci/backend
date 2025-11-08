// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/utils/notifications.js
const prisma = require('../lib/prisma');

/**
 * Belirli bir kullanıcı için yeni bir bildirim oluşturur VE anlık olarak gönderir.
 * @param {function | null} sendRealtimeNotification - (DÜZELTME) server.js'den gelen anlık bildirim fonksiyonu.
 */
async function createNotification(userId, message, boardId = null, taskId = null, commentId = null, sendRealtimeNotification = null) {
    if (!userId || !message) {
        console.error("Bildirim oluşturulamadı: userId veya message eksik.");
        return null;
    }

    try {
        const newNotification = await prisma.notification.create({
            data: {
                userId,
                message,
                boardId: boardId || undefined, // null ise undefined gönder
                taskId: taskId || undefined,
                commentId: commentId || undefined,
                isRead: false,
            },
            // DÜZELTME: Anlık bildirimde 'include' gerekir (Frontend'in ihtiyacı olan)
            include: {
                task: { select: { id: true, title: true } },
                board: { select: { id: true, name: true } },
                comment: { select: { id: true } }
            }
        });

        // --- DÜZELTME: WebSocket ile Anlık Bildirim Gönderme ---
        if (sendRealtimeNotification) {
            sendRealtimeNotification(userId, newNotification);
        } else {
             console.warn(`Bildirim DB'ye kaydedildi (Socket fonksiyonu 'sendRealtimeNotification' sağlanmadı): ${userId}`);
        }
        // --- BİTİŞ ---

        return newNotification;

    } catch (error) {
        console.error(`Bildirim oluşturulurken hata (User: ${userId}):`, error.message);
        return null;
    }
}

/**
 * @param {function | null} sendRealtimeNotification - (DÜZELTME) Anlık bildirim fonksiyonu eklendi.
 */
async function sendMentionNotifications(text, authorId, notificationMessageTemplate, boardId, taskId = null, commentId = null, sendRealtimeNotification = null) {
    if (!text) return;

    const mentionRegex = /@(\w+)/g;
    const mentionedUsernames = [...text.matchAll(mentionRegex)].map(match => match[1]);

    if (mentionedUsernames.length === 0) return;

    try {
        const mentionedUsers = await prisma.user.findMany({
            where: {
                username: { in: mentionedUsernames },
                isActive: true, 
                id: { not: authorId } 
            },
            select: { id: true } 
        });

        const author = await prisma.user.findUnique({where: {id: authorId}, select: {name: true}});
        const authorName = author ? author.name : 'Bir kullanıcı';
        const preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
        const message = notificationMessageTemplate
                            .replace('{authorName}', authorName)
                            .replace('{preview}', preview);

        for (const user of mentionedUsers) {
             await createNotification(
                 user.id, 
                 message, 
                 boardId, 
                 taskId, 
                 commentId, 
                 sendRealtimeNotification // Fonksiyonu buraya ekle
             );
        }

    } catch (error) {
        console.error("Mention bildirimi gönderilirken hata:", error);
    }
}

module.exports = { createNotification, sendMentionNotifications };