// utils/activityLogger.js
const prisma = require('../lib/prisma'); // Prisma Client'ı import et

/**
 * Aktivite loglarını veritabanına kaydeder.
 * @param {string | null} userId - Aktiviteyi yapan kullanıcının ID'si (sistem olayıysa null olabilir).
 * @param {string} boardId - Aktivitenin gerçekleştiği panonun ID'si.
 * @param {string} actionType - Yapılan işlemin türü (ActivityActionType enum'undan bir değer).
 * @param {string | null} details - Aktiviteyle ilgili ek açıklama (örn: "Görevin adını değiştirdi").
 * @param {string | null} taskId - Aktivitenin ilgili olduğu görev ID'si (varsa).
 * @param {string | null} taskListId - Aktivitenin ilgili olduğu liste ID'si (varsa).
 * @param {string | null} commentId - Aktivitenin ilgili olduğu yorum ID'si (varsa).
 */
async function logActivity(userId, boardId, actionType, details = null, taskId = null, taskListId = null, commentId = null) {
  try {
    // Güvenlik: boardId var mı kontrolü (kritik ilişki)
    if (!boardId) {
        // boardId olmadan loglama yapılamaz, çünkü her log bir panoya bağlı olmalı.
        console.warn(`Aktivite loglanamadı: boardId eksik. User: ${userId}, Action: ${actionType}`);
        // Hata fırlatmak yerine sadece uyarı verip devam edebiliriz,
        // çünkü loglama hatası ana işlemi durdurmamalı.
        return;
    }

    // Veritabanına log kaydını oluştur
    await prisma.activityLog.create({
      data: {
        userId: userId || undefined, // Eğer userId null veya undefined ise, DB'ye null/undefined olarak gider
        boardId: boardId,
        actionType: actionType, // schema.prisma'daki enum ile eşleşmeli
        details: details,       // İsteğe bağlı açıklama
        taskId: taskId || undefined,
        taskListId: taskListId || undefined,
        commentId: commentId || undefined,
        // Yeni ilişkiler eklenirse buraya da eklenmeli (örn: tagId, attachmentId vb.)
      },
    });

    // Başarılı loglama sonrası konsola yazdırma (opsiyonel, debug için)
    // console.log(`Activity Logged: User ${userId || 'System'} -> ${actionType} on Board ${boardId}`);

  } catch (error) {
    // Loglama hatası ana uygulamanın akışını durdurmamalı.
    // Hatayı sadece konsola yazdırıp devam ediyoruz.
    console.error(`Aktivite loglama sırasında hata oluştu (User: ${userId}, Board: ${boardId}, Action: ${actionType}):`, error.message);
    // Daha detaylı hata takibi için bir loglama servisine (örn: Sentry) gönderilebilir.
  }
}

// Fonksiyonu diğer dosyalarda kullanılmak üzere dışa aktar
module.exports = { logActivity };