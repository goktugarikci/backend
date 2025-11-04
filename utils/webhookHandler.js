// utils/webhookHandler.js
const prisma = require('../lib/prisma');
const axios = require('axios'); // HTTP istekleri için

/**
 * Belirli bir olay türü için ilgili panodaki aktif webhook'ları bulur ve tetikler.
 * @param {string} boardId - Olayın gerçekleştiği pano ID'si.
 * @param {string} eventType - Gerçekleşen olayın türü (ActivityActionType enum değeri).
 * @param {object} payload - Webhook'a gönderilecek veri (örn: oluşturulan görev, yorum vb.).
 */
async function triggerWebhooks(boardId, eventType, payload) {
    if (!boardId || !eventType) return;

    try {
        // İlgili panoda, bu olay türünü dinleyen ve aktif olan webhook'ları bul
        const webhooks = await prisma.webhook.findMany({
            where: {
                boardId: boardId,
                isActive: true,
                eventTypes: { has: eventType } // Dizi içinde bu eventType var mı?
            },
            select: { targetUrl: true } // Sadece URL'leri al
        });

        if (webhooks.length === 0) return; // Tetiklenecek webhook yoksa çık

        // Her webhook URL'ine asenkron olarak POST isteği gönder
        const requests = webhooks.map(webhook => {
            console.log(`Webhook tetikleniyor: ${eventType} -> ${webhook.targetUrl}`);
            return axios.post(webhook.targetUrl, {
                event: eventType,
                timestamp: new Date().toISOString(),
                boardId: boardId,
                data: payload // Asıl olay verisi
            }, {
                timeout: 5000, // 5 saniye zaman aşımı
                headers: { 'Content-Type': 'application/json' }
            }).catch(error => {
                // Hata durumunda logla ama diğerlerini engelleme
                console.error(`Webhook GÖNDERİM HATASI (${webhook.targetUrl}):`, error.response?.status, error.message);
            });
        });

        // Tüm isteklerin tamamlanmasını beklemeden devam et (ateşle ve unut)
        Promise.allSettled(requests);

    } catch (error) {
        console.error(`Webhook tetikleme hatası (Board: ${boardId}, Event: ${eventType}):`, error.message);
    }
}

module.exports = { triggerWebhooks };