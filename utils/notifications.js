// utils/notifications.js
const prisma = require('../lib/prisma');

/**
 * Belirli bir kullanıcı için yeni bir bildirim oluşturur.
 * @param {string} userId - Bildirimi alacak kullanıcının ID'si.
 * @param {string} message - Bildirim mesajı.
 * @param {string | null} boardId - Bildirimin ilgili olduğu Pano ID'si (varsa).
 * @param {string | null} taskId - Bildirimin ilgili olduğu Görev ID'si (varsa).
 * @param {string | null} commentId - Bildirimin ilgili olduğu Yorum ID'si (varsa).
 * @returns {Promise<object | null>} Oluşturulan bildirim objesi veya hata durumunda null.
 */
async function createNotification(userId, message, boardId = null, taskId = null, commentId = null) {
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
            }
        });

        // --- WebSocket ile Anlık Bildirim Gönderme ---
        // server.js'den 'io' instance'ını almanın bir yolunu bulmamız lazım.
        // Ya global hale getireceğiz (pek önerilmez) ya da bu fonksiyona parametre olarak geçeceğiz.
        // Şimdilik sadece loglayalım. server.js güncellemesinde WebSocket'i ekleriz.
        console.log(`Anlık Bildirim Gönderilecek (Kullanıcı: ${userId}): ${message}`);
        // io.to(userId).emit('new_notification', newNotification); // -> Bu satırı server.js'de handle edeceğiz

        return newNotification;

    } catch (error) {
        console.error(`Bildirim oluşturulurken hata (User: ${userId}):`, error.message);
        return null;
    }
}

/**
 * Verilen metin içindeki @bahsetmelerini bulur, ilgili kullanıcıları
 * veritabanından çeker ve onlara bildirim gönderir.
 * @param {string} text - @bahsetmeleri içerebilecek metin (yorum, açıklama vb.).
 * @param {string} authorId - Metni yazan kullanıcının ID'si (kendine bildirim gitmesin).
 * @param {string} notificationMessageTemplate - Bildirim mesajı şablonu (örn: "{authorName} sizden bahsetti: {preview}").
 * @param {string} boardId - İlgili Pano ID'si.
 * @param {string | null} taskId - İlgili Görev ID'si (varsa).
 * @param {string | null} commentId - İlgili Yorum ID'si (varsa).
 */
async function sendMentionNotifications(text, authorId, notificationMessageTemplate, boardId, taskId = null, commentId = null) {
    if (!text) return;

    // Basit @kullaniciadi regex'i (sadece harf, rakam ve _)
    const mentionRegex = /@(\w+)/g;
    const mentionedUsernames = [...text.matchAll(mentionRegex)].map(match => match[1]);

    if (mentionedUsernames.length === 0) return;

    try {
        // Bahsedilen kullanıcıları DB'den bul
        const mentionedUsers = await prisma.user.findMany({
            where: {
                username: { in: mentionedUsernames },
                isActive: true, // Sadece aktif kullanıcılara bildirim gönder
                id: { not: authorId } // Yazar kendine bildirim almasın
            },
            select: { id: true } // Sadece ID'leri yeterli
        });

        // Bildirim mesajını hazırla
        const author = await prisma.user.findUnique({where: {id: authorId}, select: {name: true}});
        const authorName = author ? author.name : 'Bir kullanıcı';
        const preview = text.substring(0, 50) + (text.length > 50 ? '...' : '');
        const message = notificationMessageTemplate
                            .replace('{authorName}', authorName)
                            .replace('{preview}', preview);

        // Bulunan her kullanıcıya bildirim gönder
        for (const user of mentionedUsers) {
            // Güvenlik: Bahsedilen kullanıcının panoya erişimi var mı? Kontrolü eklenebilir!
            // const mentionedUserRole = await getUserRoleInBoard(user.id, boardId);
            // if (hasRequiredRole('VIEWER', mentionedUserRole)) {
                 await createNotification(user.id, message, boardId, taskId, commentId);
            // }
        }

    } catch (error) {
        console.error("Mention bildirimi gönderilirken hata:", error);
    }
}

module.exports = { createNotification, sendMentionNotifications }; // Yeni fonksiyonu ekle