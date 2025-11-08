// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/controllers/reaction.controller.js
const prisma = require('../lib/prisma');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');

// --- YARDIMCI GÜVENLİK FONKSİYONLARI ---

// Kullanıcının bir Pano üzerinde (belirtilen minimum rolle) yetkisi olup olmadığını kontrol eder
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

// Kullanıcının bir Görev üzerinde (belirtilen minimum rolle) yetkisi olup olmadığını kontrol eder
const checkTaskPermission = async (userId, taskId, requiredRole = 'VIEWER') => {
  if (!userId || !taskId) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { taskList: { select: { boardId: true } } },
    });
    if (!task) return false; // Görev yoksa yetki de yok
    return await checkBoardPermission(userId, task.taskList.boardId, requiredRole);
  } catch (error) {
    console.error(`checkTaskPermission error for task ${taskId}:`, error);
    return false;
  }
};

// Yorum ID'sinden Pano ID'sini bulan yardımcı fonksiyon
const getBoardIdFromComment = async (commentId) => {
    try {
        const comment = await prisma.taskComment.findUnique({
            where: { id: commentId },
            select: { task: { select: { taskList: { select: { boardId: true } } } } }
        });
        return comment?.task?.taskList?.boardId ?? null;
    } catch (error) {
        console.error(`Error fetching boardId for comment ${commentId}:`, error);
        return null;
    }
};
// --- BİTİŞ: YARDIMCI FONKSİYONLAR ---


// 1. Bir Göreve Reaksiyon Ekle/Kaldır (Toggle)
exports.toggleTaskReaction = async (req, res) => {
    const { taskId } = req.params;
    const { emoji } = req.body; 
    const userId = req.user.id; 

    if (!emoji) {
        return res.status(400).json({ msg: 'Emoji gerekli.' });
    }

    try {
        // Güvenlik: Kullanıcı bu görevi (ve panoyu) görebilir mi? (COMMENTER rolü)
        if (!await checkTaskPermission(userId, taskId, 'COMMENTER')) {
             const taskExists = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
             if (!taskExists) {
                return res.status(404).json({ msg: 'Görev bulunamadı.' });
             }
            return res.status(403).json({ msg: 'Bu göreve tepki verme yetkiniz yok.' });
        }

        // Mevcut reaksiyonu (benzersiz anahtar üzerinden) bul
        const existingReaction = await prisma.reaction.findUnique({
            where: {
                userId_emoji_taskId: {
                    userId: userId,
                    emoji: emoji,
                    taskId: taskId,
                }
            }
        });

        let message;

        if (existingReaction) {
            // Reaksiyon varsa: Sil
            await prisma.reaction.delete({
                where: { id: existingReaction.id }
            });
            message = 'Reaksiyon kaldırıldı.';

        } else {
            // Reaksiyon yoksa: Oluştur
            await prisma.reaction.create({
                data: {
                    emoji: emoji,
                    userId: userId,
                    taskId: taskId, // Göreve bağla
                }
            });
            message = 'Reaksiyon eklendi.';
        }

        // DÜZELTME: 'groupBy' yerine 'findMany' kullanarak tam listeyi (user objesi dahil) döndür
        // Bu, frontend'deki 'ReactionSummary[]' tipiyle eşleşir.
        const updatedReactions = await prisma.reaction.findMany({
            where: { taskId: taskId },
            include: {
                user: { select: { id: true, name: true } } // Frontend'in ihtiyacı olan user bilgisi
            },
            orderBy: { createdAt: 'asc' } // Oluşturulma sırasına göre
        });

        res.status(existingReaction ? 200 : 201).json({ message, reactions: updatedReactions });


    } catch (err) {
        console.error("toggleTaskReaction Hatası:", err.message);
        if (err.code === 'P2002') {
             return res.status(409).json({ msg: 'Reaksiyon eklenirken çakışma oluştu, tekrar deneyin.' });
        }
        if (err.code === 'P2025') {
            return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Bir Yoruma Reaksiyon Ekle/Kaldır (Toggle)
exports.toggleCommentReaction = async (req, res) => {
    const { commentId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id; 

    if (!emoji) {
        return res.status(400).json({ msg: 'Emoji gerekli.' });
    }

    try {
        // Güvenlik: Kullanıcı bu yorumun olduğu panoya erişebilir mi? (COMMENTER rolü)
        const boardId = await getBoardIdFromComment(commentId);
        if (!boardId) {
             return res.status(404).json({ msg: 'İlişkili yorum veya pano bulunamadı.' });
        }
        if (!await checkBoardPermission(userId, boardId, 'COMMENTER')) {
            return res.status(403).json({ msg: 'Bu yoruma tepki verme yetkiniz yok.' });
        }

        // Mevcut reaksiyonu bul
        const existingReaction = await prisma.reaction.findUnique({
            where: {
                 userId_emoji_commentId: { 
                    userId: userId,
                    emoji: emoji,
                    commentId: commentId,
                }
            }
        });

        let message;

        if (existingReaction) {
            // Varsa: Sil
            await prisma.reaction.delete({
                where: { id: existingReaction.id }
            });
            message = 'Reaksiyon kaldırıldı.';
        } else {
            // Yoksa: Oluştur
            await prisma.reaction.create({
                data: {
                    emoji: emoji,
                    userId: userId,
                    commentId: commentId, // Yoruma bağla
                }
            });
            message = 'Reaksiyon eklendi.';
        }

        // DÜZELTME: 'groupBy' yerine 'findMany' kullanarak tam listeyi (user objesi dahil) döndür
        const updatedReactions = await prisma.reaction.findMany({
           where: { commentId: commentId },
           include: {
               user: { select: { id: true, name: true } }
           },
           orderBy: { createdAt: 'asc' }
        });

        res.status(existingReaction ? 200 : 201).json({ message, reactions: updatedReactions });

    } catch (err) {
        console.error("toggleCommentReaction Hatası:", err.message);
        if (err.code === 'P2002') {
             return res.status(409).json({ msg: 'Reaksiyon eklenirken çakışma oluştu, tekrar deneyin.' });
        }
        if (err.code === 'P2025') {
            return res.status(404).json({ msg: 'İlişkili yorum bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};