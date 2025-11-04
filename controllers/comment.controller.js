const prisma = require('../lib/prisma');
const { logActivity } = require('../utils/activityLogger'); // Loglama yardımcısı
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization'); // Yetkilendirme yardımcıları
const { createNotification, sendMentionNotifications } = require('../utils/notifications'); // Bildirim yardımcıları

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
// Kullanıcının bir Görev üzerinde (belirtilen minimum rolle) yetkisi olup olmadığını kontrol eder
const checkTaskPermission = async (userId, taskId, requiredRole = 'VIEWER') => {
  if (!userId || !taskId) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { taskList: { select: { boardId: true } } },
    });
    if (!task) return false; // Görev yoksa yetki de yok
    const userRole = await getUserRoleInBoard(userId, task.taskList.boardId);
    return hasRequiredRole(requiredRole, userRole);
  } catch (error) {
    console.error(`checkTaskPermission error for task ${taskId}:`, error);
    return false;
  }
};
// --- BİTİŞ ---

// 1. Bir Göreve Yorum Ekle (Yetki: COMMENTER veya üstü)
exports.createComment = async (req, res) => {
  const { taskId } = req.params;
  const { text } = req.body;
  const userId = req.user.id; // Yorumu yapan kişi (authMiddleware'den)

  if (!text || text.trim() === '') {
    return res.status(400).json({ msg: 'Yorum metni boş olamaz.' });
  }

  try {
    // Güvenlik: Görevi ve panosunu bul
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
          title: true, // Bildirim ve log için
          assigneeIds: true, // Bildirim için
          createdById: true, // Bildirim için
          taskList: { select: { boardId: true }}
      }
    });
    if (!task || !task.taskList) return res.status(404).json({ msg: 'İlişkili görev veya liste bulunamadı.' });
    const boardId = task.taskList.boardId;

    // Yetki kontrolü: Yorum yapmak için en az COMMENTER olmalı
    if (!await checkBoardPermission(userId, boardId, 'COMMENTER')) {
      return res.status(403).json({ msg: 'Bu göreve yorum yapma yetkiniz yok.' });
    }

    // Yorumu oluştur
    const newComment = await prisma.taskComment.create({
      data: {
        text: text.trim(),
        taskId: taskId,
        authorId: userId,
      },
      include: { // Yanıtta yazar bilgisini döndür
        author: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    // Aktivite Logla
    await logActivity(userId, boardId, 'ADD_TASK_COMMENT', `"${newComment.text.substring(0, 30)}..." yorumunu ekledi`, taskId, null, newComment.id);

    // --- Bildirim Oluştur (Standart) ---
    const author = newComment.author;
    const messageTemplate = `"${author ? author.name : 'Biri'}" "${task.title}" görevine yorum yaptı: {preview}`;
    const previewText = text.substring(0, 50) + (text.length > 50 ? '...' : '');
    const standardMessage = messageTemplate.replace('{preview}', previewText);

    // Görevi oluşturan + atananlar (yorum yapan hariç)
    const recipients = new Set([task.createdById, ...task.assigneeIds]);
    recipients.delete(userId); // Kendine bildirim gitmesin
    recipients.delete(null); // Null ID'leri temizle

    for (const recipientId of recipients) {
        if (recipientId) {
             await createNotification(recipientId, standardMessage, boardId, taskId, newComment.id);
        }
    }
    // --- Bitiş: Standart Bildirim ---

    // --- @Mention Bildirimi ---
    const mentionMessageTemplate = `{authorName} sizden "${task.title}" görevindeki bir yorumda bahsetti: {preview}`;
    await sendMentionNotifications(text, userId, mentionMessageTemplate.replace('{preview}', previewText), boardId, taskId, newComment.id);
    // --- Bitiş: @Mention Bildirimi ---

    res.status(201).json(newComment);
  } catch (err) {
      console.error("createComment Hatası:", err.message);
      if (err.code === 'P2003' || err.code === 'P2025') return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
      res.status(500).send('Sunucu Hatası');
     }
};

// 2. Bir Görevin Yorumlarını Getir (Yetki: VIEWER veya üstü)
exports.getCommentsForTask = async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  try {
    // Güvenlik: Kullanıcı bu görevi (ve yorumları) görebilir mi?
    if (!await checkTaskPermission(userId, taskId, 'VIEWER')) {
      return res.status(403).json({ msg: 'Bu yorumları görme yetkiniz yok.' });
    }

    // Yorumları çek
    const comments = await prisma.taskComment.findMany({
      where: { taskId: taskId },
      orderBy: { createdAt: 'asc' }, // Eskiden yeniye
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } }, // Yazar bilgisi
        reactions: { // Reaksiyonları da getirelim (opsiyonel)
            select: { emoji: true, userId: true } // Sadece emoji ve kimin verdiği
            // Veya groupBy ile sayım yapılabilir
        }
      }
    });
    res.json(comments);
  } catch (err) {
    console.error("getCommentsForTask Hatası:", err.message);
    if (err.code === 'P2025') return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. Bir Yorumu Sil (Yetki: Yorumu yazan kişi VEYA ADMIN)
exports.deleteComment = async (req, res) => {
    const { commentId } = req.params;
    const userId = req.user.id; // Silme işlemini yapan

    try {
        const comment = await prisma.taskComment.findUnique({
            where: { id: commentId },
            select: {
                authorId: true, // Yorumu kimin yazdığı
                taskId: true,   // Hangi göreve ait olduğu
                task: { select: { title: true, taskList: { select: { boardId: true }} } } // Yetki ve loglama için
            }
        });

        if (!comment || !comment.task || !comment.task.taskList) {
            return res.status(404).json({ msg: 'Yorum veya ilişkili görev/pano bulunamadı.' });
        }
        const boardId = comment.task.taskList.boardId;
        const taskId = comment.taskId;

        // Güvenlik: İşlemi yapan kişinin rolünü al
        const userRole = await getUserRoleInBoard(userId, boardId);

        // Yetki kontrolü: Yorumu yazan mı VEYA panoda ADMIN mi?
        if (comment.authorId !== userId && !hasRequiredRole('ADMIN', userRole)) {
             return res.status(403).json({ msg: 'Bu yorumu silme yetkiniz yok.' });
        }

        // Yorumu sil (Cascade ile reaksiyonları ve bildirimleri de silebilir - şemaya bağlı)
        await prisma.taskComment.delete({ where: { id: commentId } });

        // Aktivite Logla
        await logActivity(userId, boardId, 'DELETE_TASK_COMMENT', `"${comment.task.title}" görevinden bir yorumu sildi`, taskId, null, commentId);

        res.json({ msg: 'Yorum başarıyla silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Yorum bulunamadı.' });
        console.error("deleteComment Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// --- YARDIMCI Fonksiyon (checkBoardPermission) ---
// (Bu fonksiyonun board.controller.js veya utils/authorization.js gibi bir yerden import edildiğini varsayıyoruz)
const checkBoardPermission = async (userId, boardId, requiredRole = 'VIEWER') => {
  if (!userId || !boardId) return false;
  try {
    const userRole = await getUserRoleInBoard(userId, boardId);
    return hasRequiredRole(requiredRole, userRole);
  } catch (error) {
    console.error(`checkBoardPermission error for board ${boardId}:`, error);
    return false;
  }
};