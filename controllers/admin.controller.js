const prisma = require('../lib/prisma');

// 1. Tüm Panoları (Grupları) Listele
exports.getAllBoards = async (req, res) => {
  try {
    const boards = await prisma.board.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true, lists: true } }, // Üye ve liste sayısı
        createdBy: { select: { id: true, name: true, email: true } } // Oluşturan kişi
      }
    });
    res.json(boards);
  } catch (err) {
    console.error("Admin - Tüm Panoları Getirme Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. Belirli Bir Panonun Detaylarını Getir (Admin Gözüyle)
exports.getBoardDetailsAdmin = async (req, res) => {
  const { boardId } = req.params;
  try {
    // Admin olduğu için üyelik kontrolü yapmadan doğrudan panoyu getiriyoruz
    // (board.controller.js'deki getBoardById ile çok benzer, sadece üyelik kontrolü yok)
    const boardDetails = await prisma.board.findUnique({
      where: { id: boardId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
        tags: true,
        lists: { /* ... getBoardById'deki gibi tüm detaylar ... */
            orderBy: { order: 'asc' },
            include: {
                tasks: {
                orderBy: { createdAt: 'asc' },
                include: {
                    assignees: { select: { id: true, name: true, avatarUrl: true }},
                    tags: true,
                    checklistItems: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            assignees: { select: { id: true, name: true, avatarUrl: true }},
                            images: true
                        }
                    },
                    _count: { select: { checklistItems: true } }
                }
                }
            }
        }
      }
    });

    if (!boardDetails) {
      return res.status(404).json({ msg: 'Pano bulunamadı.' });
    }
    res.json(boardDetails);
  } catch (err) {
    console.error(`Admin - Pano Detayı (${boardId}) Getirme Hatası:`, err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. Tüm Kullanıcıları Listele
exports.getAllUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: { // Şifre HARIÇ
                id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true, googleId: true,
                isActive: true, // Yeni alanı ekle
                _count: { select: { boards: true, submittedTickets: true }}
            }
        });
        res.json(users);
    } catch (err) { console.error("Admin - GetAllUsers Error:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 4. Belirli Bir Kullanıcının Detaylarını Getir (Admin Gözüyle)
exports.getUserDetailsAdmin = async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true, googleId: true, isActive: true, // Yeni alanı ekle
                boards: { select: { role: true, joinedAt: true, board: { select: { id: true, name: true } } } },
                submittedTickets: { orderBy: { createdAt: 'desc'}, take: 10, select: { id: true, subject: true, status: true, createdAt: true } }
            }
        });
        if (!user) return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
        res.json(user);
    } catch (err) { console.error(`Admin - GetUserDetails Error (${userId}):`, err.message); res.status(500).send('Sunucu Hatası'); }
};

// 5. Toplu Mesaj Gönderme
exports.sendBulkMessage = async (req, res) => { /* ... (Kod aynı) ... */ };


// --- YENİ EKLENEN YÖNETİM FONKSİYONLARI ---

// === Kullanıcı Yönetimi ===

// 6. Kullanıcı Rolünü Değiştirme
exports.changeUserRole = async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body; // Yeni rol: "USER" | "ADMIN"
    const adminUserId = req.user.id; // İşlemi yapan admin

    const validRoles = ['USER', 'ADMIN'];
    if (!role || !validRoles.includes(role.toUpperCase())) {
        return res.status(400).json({ msg: 'Geçersiz rol belirtildi (USER veya ADMIN).' });
    }
    const newRole = role.toUpperCase();

    // Güvenlik: Admin kendini değiştiremez (rol düşürme/yükseltme için)
    if (userId === adminUserId) {
        return res.status(400).json({ msg: 'Yönetici kendi rolünü bu şekilde değiştiremez.' });
    }

    try {
        // Hedef kullanıcıyı bul
        const userToUpdate = await prisma.user.findUnique({ where: { id: userId } });
        if (!userToUpdate) return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });

        // Güvenlik: Son ADMIN'in rolünü düşürmeyi engelle (opsiyonel ama önerilir)
        if (userToUpdate.role === 'ADMIN' && newRole === 'USER') {
            const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                return res.status(400).json({ msg: 'Sistemdeki son yöneticinin rolünü düşüremezsiniz.' });
            }
        }

        // Rolü güncelle
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { role: newRole },
            select: { id: true, name: true, email: true, role: true, isActive: true } // Güncel halini döndür
        });

        // Aktivite Logla (Global Admin aktivitesi için Pano ID'si gerekmeyebilir veya özel bir loglama yapılabilir)
        // logActivity(adminUserId, null, 'CHANGE_USER_ROLE', ...);

        res.json(updatedUser);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
        console.error("changeUserRole Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 7. Kullanıcı Hesabını Aktif/Pasif Yapma
exports.setUserStatus = async (req, res) => {
    const { userId } = req.params;
    const { isActive } = req.body; // true | false
    const adminUserId = req.user.id;

    if (typeof isActive !== 'boolean') {
        return res.status(400).json({ msg: 'Geçersiz durum (isActive true veya false olmalı).' });
    }

    // Güvenlik: Admin kendini pasif yapamaz
    if (userId === adminUserId && !isActive) {
        return res.status(400).json({ msg: 'Yönetici kendi hesabını pasif yapamaz.' });
    }

    try {
        const userToUpdate = await prisma.user.findUnique({ where: { id: userId } });
        if (!userToUpdate) return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });

        // Güvenlik: Son aktif ADMIN'i pasif yapmayı engelle
        if (userToUpdate.role === 'ADMIN' && !isActive) {
            const activeAdminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
            if (activeAdminCount <= 1) {
                return res.status(400).json({ msg: 'Sistemdeki son aktif yöneticinin hesabını pasif yapamazsınız.' });
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { isActive: isActive },
            select: { id: true, name: true, email: true, role: true, isActive: true }
        });

        // logActivity(adminUserId, null, isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', ...);
        res.json(updatedUser);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
        console.error("setUserStatus Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 8. Kullanıcı Hesabını Silme
exports.deleteUser = async (req, res) => {
    const { userId } = req.params;
    const adminUserId = req.user.id;

    // Güvenlik: Admin kendini silemez
    if (userId === adminUserId) {
        return res.status(400).json({ msg: 'Yönetici kendi hesabını silemez.' });
    }

    try {
        const userToDelete = await prisma.user.findUnique({ where: { id: userId } });
        if (!userToDelete) return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });

        // Güvenlik: Son ADMIN'i silmeyi engelle
        if (userToDelete.role === 'ADMIN') {
            const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                return res.status(400).json({ msg: 'Sistemdeki son yöneticiyi silemezsiniz.' });
            }
        }

        // Kullanıcıyı sil (İlişkili veriler schema'daki onDelete kurallarına göre handle edilir)
        // Dikkat: Bu işlem kalıcıdır!
        await prisma.user.delete({
            where: { id: userId }
        });

        // logActivity(adminUserId, null, 'DELETE_USER', ...);
        res.json({ msg: `Kullanıcı (${userToDelete.email}) başarıyla silindi.` });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
        console.error("deleteUser Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};


// === Pano Yönetimi (Admin) ===

// 9. Herhangi Bir Panoyu Silme
exports.deleteAnyBoard = async (req, res) => {
    const { boardId } = req.params;
    const adminUserId = req.user.id;

    try {
        // Panoyu bul (var mı diye kontrol etmek için)
        const boardToDelete = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true, createdById: true } });
        if (!boardToDelete) return res.status(404).json({ msg: 'Pano bulunamadı.' });

        // İşlem: Panoyu sil (Cascade silme her şeyi siler)
        await prisma.board.delete({
            where: { id: boardId }
        });

        // Loglama (Pano silindiği için global bir yere veya admin loguna)
        console.log(`Admin ${adminUserId} deleted board ${boardId} ("${boardToDelete.name}")`);
        // logActivity(adminUserId, null, 'ADMIN_DELETE_BOARD', ...);

        res.json({ msg: 'Pano başarıyla silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Pano bulunamadı.' });
        console.error("deleteAnyBoard Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 10. Pano Sahipliğini Aktarma
exports.transferBoardOwnership = async (req, res) => {
    const { boardId } = req.params;
    const { newOwnerUserId } = req.body;
    const adminUserId = req.user.id; // İşlemi yapan Admin

    if (!newOwnerUserId) return res.status(400).json({ msg: 'Yeni sahip IDsi (newOwnerUserId) gerekli.' });

    try {
        // 1. Pano ve mevcut sahibi kontrol et
        const board = await prisma.board.findUnique({ where: { id: boardId }, select: { createdById: true } });
        if (!board) return res.status(404).json({ msg: 'Pano bulunamadı.' });

        // 2. Yeni sahip sistemde var mı ve panoya üye mi?
        const newOwnerMembership = await prisma.boardMembership.findUnique({
            where: { userId_boardId: { userId: newOwnerUserId, boardId: boardId } }
        });
        if (!newOwnerMembership) {
            return res.status(400).json({ msg: 'Yeni sahip panonun üyesi değil. Önce üyeliğini ekleyin.' });
        }

        // 3. İşlem: Sahipliği aktar ve yeni sahibi ADMIN yap (Transaction içinde)
        const [updatedBoard, updatedMembership] = await prisma.$transaction([
            prisma.board.update({
                where: { id: boardId },
                data: { createdById: newOwnerUserId } // Sahipliği değiştir
            }),
            prisma.boardMembership.update({
                where: { userId_boardId: { userId: newOwnerUserId, boardId: boardId } },
                data: { role: 'ADMIN' } // Yeni sahibi ADMIN yap
            })
            // Opsiyonel: Eski sahibin rolünü düşürme
            // prisma.boardMembership.update({ where: { userId_boardId: { userId: board.createdById, boardId: boardId }}, data: { role: 'EDITOR' }})
        ]);

        // logActivity(adminUserId, boardId, 'TRANSFER_OWNERSHIP', ...);
        res.json({ msg: 'Pano sahipliği başarıyla aktarıldı.', board: updatedBoard });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Pano veya kullanıcı bulunamadı.' });
        console.error("transferBoardOwnership Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};


// === İçerik Yönetimi / Moderasyon ===

// 11. Herhangi Bir Yorumu Silme
exports.deleteAnyComment = async (req, res) => {
    const { commentId } = req.params;
    const adminUserId = req.user.id;

    try {
        const comment = await prisma.taskComment.findUnique({
            where: { id: commentId },
            select: { task: { select: { title: true, taskList: { select: { boardId: true }} } } }
        });
        if (!comment || !comment.task || !comment.task.taskList) {
            return res.status(404).json({ msg: 'Yorum veya ilişkili görev/pano bulunamadı.' });
        }

        await prisma.taskComment.delete({ where: { id: commentId } });

        // logActivity(adminUserId, comment.task.taskList.boardId, 'ADMIN_DELETE_COMMENT', ...);
        res.json({ msg: 'Yorum başarıyla silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Yorum bulunamadı.' });
        console.error("deleteAnyComment Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 12. Herhangi Bir Eki Silme
exports.deleteAnyAttachment = async (req, res) => {
    const { attachmentId } = req.params;
    const adminUserId = req.user.id;

    try {
        const attachment = await prisma.taskAttachment.findUnique({
            where: { id: attachmentId },
            select: { url: true, taskId: true, fileName: true, task: { select: { taskList: { select: { boardId: true }} } } }
        });
        if (!attachment || !attachment.task || !attachment.task.taskList) {
            return res.status(404).json({ msg: 'Ek veya ilişkili görev/pano bulunamadı.' });
        }

        // 1. DB'den Sil
        await prisma.taskAttachment.delete({ where: { id: attachmentId } });
        // 2. Fiziksel Dosyayı Sil
        deletePhysicalFile(attachment.url); // (Bu fonksiyonun utils'de tanımlı olduğunu varsayıyoruz)

        // logActivity(adminUserId, attachment.task.taskList.boardId, 'ADMIN_DELETE_ATTACHMENT', ...);
        res.json({ msg: 'Ek başarıyla silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Ek bulunamadı.' });
        console.error("deleteAnyAttachment Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};


// === Sistem / Raporlama ===

// 13. Sistem İstatistikleri
exports.getSystemStats = async (req, res) => {
    try {
        const [userCount, boardCount, taskCount, activeUserCount] = await prisma.$transaction([
            prisma.user.count(),
            prisma.board.count(),
            prisma.task.count(),
            prisma.user.count({ where: { isActive: true }}) // Aktif kullanıcı sayısı
        ]);
        // Daha fazla istatistik eklenebilir (örn: son 24 saatteki aktivite sayısı)

        res.json({
            userCount,
            activeUserCount,
            boardCount,
            taskCount,
            // ...
        });
    } catch (err) {
        console.error("getSystemStats Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 14. Aktivite Loglarını Gelişmiş Filtreleme
exports.getActivityLogs = async (req, res) => {
    const { userId, actionType, startDate, endDate, page = 1, limit = 50 } = req.query; // Filtreler
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const whereClause = {};
    if (userId) whereClause.userId = userId;
    if (actionType && Object.values(ActivityActionType).includes(actionType)) whereClause.actionType = actionType; // Geçerli enum mu?
    try {
        if (startDate) whereClause.timestamp = { ...whereClause.timestamp, gte: new Date(startDate + 'T00:00:00.000Z') };
        if (endDate) whereClause.timestamp = { ...whereClause.timestamp, lte: new Date(endDate + 'T23:59:59.999Z') };
    } catch(e) { return res.status(400).json({ msg: 'Geçersiz tarih formatı. YYYY-MM-DD kullanın.' }); }

    try {
        const activities = await prisma.activityLog.findMany({
            where: whereClause,
            orderBy: { timestamp: 'desc' },
            skip: skip,
            take: limitNum,
            include: { // İlişkili temel bilgileri al
                user: { select: { id: true, name: true, email: true } },
                board: { select: { id: true, name: true } },
                task: { select: { id: true, title: true } }
            }
        });
        const totalActivities = await prisma.activityLog.count({ where: whereClause });

        res.json({ activities, totalActivities, currentPage: pageNum, totalPages: Math.ceil(totalActivities / limitNum) });
    } catch (err) {
        console.error("getActivityLogs Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// === Destek Biletleri Yönetimi (Admin) ===

// 15. Bir Destek Biletini Admine Atama
exports.assignSupportTicket = async (req, res) => {
    const { ticketId } = req.params;
    const { assignAdminId } = req.body; // Atanacak admin ID'si
    const requestAdminId = req.user.id; // İşlemi yapan admin

    if (!assignAdminId) return res.status(400).json({ msg: 'Atanacak admin IDsi (assignAdminId) gerekli.' });

    try {
        // Güvenlik: Atanacak kişi gerçekten bir Admin mi?
        const adminToAssign = await prisma.user.findUnique({ where: { id: assignAdminId } });
        if (!adminToAssign || adminToAssign.role !== 'ADMIN') {
            return res.status(400).json({ msg: 'Atanacak kullanıcı bulunamadı veya Admin değil.' });
        }

        // Bileti güncelle
        const updatedTicket = await prisma.supportTicket.update({
            where: { id: ticketId },
            data: { assignedAdminId: assignAdminId },
            include: { assignedAdmin: { select: { id: true, name: true }} } // Güncel atananı döndür
        });

        // TODO: Atanan Admine bildirim gönderilebilir

        res.json(updatedTicket);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Destek bileti veya atanacak admin bulunamadı.' });
        console.error("assignSupportTicket Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 16. Destek Biletini Silme
exports.deleteSupportTicket = async (req, res) => {
    const { ticketId } = req.params;
    const adminUserId = req.user.id;

    try {
        // Silmeden önce ilişkili resimleri bul (fiziksel silme için)
        const ticket = await prisma.supportTicket.findUnique({
            where: { id: ticketId },
            include: { images: { select: { url: true } } }
        });
        if (!ticket) return res.status(404).json({ msg: 'Destek bileti bulunamadı.' });

        // 1. Fiziksel Resimleri Sil
        if (ticket.images && ticket.images.length > 0) {
            ticket.images.forEach(img => deletePhysicalFile(img.url)); // (Bu fonksiyonun utils'de olduğunu varsayıyoruz)
        }

        // 2. DB'den Bileti Sil (Cascade ile yorumlar ve image kayıtları da silinir)
        await prisma.supportTicket.delete({
            where: { id: ticketId }
        });

        // logActivity(adminUserId, null, 'ADMIN_DELETE_TICKET', ...);
        res.json({ msg: 'Destek bileti başarıyla silindi.' });

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Destek bileti bulunamadı.' });
        console.error("deleteSupportTicket Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// --- Utils Fonksiyonu (Eğer ayrı dosyada değilse) ---
const deletePhysicalFile = (fileUrl) => {
  if (!fileUrl) return;
  const filePath = path.join(__dirname, '..', fileUrl.replace('/uploads/', 'uploads/'));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
       console.error(`Fiziksel dosya silinemedi: ${filePath}`, err);
    }
  });
};