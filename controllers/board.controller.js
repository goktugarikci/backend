const prisma = require('../lib/prisma');
const { logActivity } = require('../utils/activityLogger');
// Yeni yetkilendirme yardımcılarını import et
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
// Kullanıcının panonun "Oluşturanı" (Creator) olup olmadığını kontrol eder
const checkCreatorAccess = async (userId, boardId) => {
  if (!userId || !boardId) return false;
  try {
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { createdById: true } });
    return board && board.createdById === userId;
  } catch (error) { console.error(`checkCreatorAccess error:`, error); return false; }
};


// 1. Yeni Pano Oluştur
exports.createBoard = async (req, res) => {
  const { name, type } = req.body;
  const userId = req.user.id;
  if (!name || name.trim() === '') return res.status(400).json({ msg: 'Pano adı boş olamaz.' });

  try {
    const newBoard = await prisma.board.create({
      data: {
        name: name.trim(),
        type: type === 'GROUP' ? 'GROUP' : 'INDIVIDUAL',
        createdById: userId,
        members: { create: { userId: userId, role: 'ADMIN' } },
      },
    });
    await logActivity(userId, newBoard.id, 'CREATE_BOARD', `"${newBoard.name}" panosunu oluşturdu`);
    res.status(201).json(newBoard);
  } catch (err) { console.error("createBoard Hatası:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 2. Kullanıcının Üye Olduğu Panoları Getir
exports.getMyBoards = async (req, res) => {
  const userId = req.user.id;
  try {
    const memberships = await prisma.boardMembership.findMany({
      where: { userId: userId },
      include: { board: { select: { id: true, name: true, type: true, createdAt: true, _count: { select: { members: true }} } } },
      orderBy: { board: { createdAt: 'desc' } }
    });
    const boards = memberships.map(m => m.board);
    res.json(boards);
  } catch (err) { console.error("getMyBoards Hatası:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 3. Tek Bir Panonun Tüm Detaylarını Getir (Filtreleme/Sıralama ile)
exports.getBoardById = async (req, res) => {
  const { boardId } = req.params;
  const userId = req.user.id;
  const { assignee, tag, priority, status, dueDateBefore, dueDateAfter, search, sortBy, sortOrder } = req.query;

  try {
    // Güvenlik: Kullanıcının rolünü al (En az VIEWER olmalı)
    const userRole = await getUserRoleInBoard(userId, boardId);
    if (!hasRequiredRole('VIEWER', userRole)) {
      return res.status(403).json({ msg: 'Bu panoyu görüntüleme yetkiniz yok.' });
    }

    // --- Dinamik Task Sorgusu ---
    const taskWhereClause = {};
    if (assignee) taskWhereClause.assigneeIds = { has: assignee };
    if (tag) taskWhereClause.tagIds = { has: tag };
    if (priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority.toUpperCase())) taskWhereClause.priority = priority.toUpperCase();
    if (status && ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) taskWhereClause.approvalStatus = status.toUpperCase();
    if (dueDateBefore) taskWhereClause.dueDate = { ...taskWhereClause.dueDate, lte: new Date(dueDateBefore + 'T23:59:59.999Z') };
    if (dueDateAfter) taskWhereClause.dueDate = { ...taskWhereClause.dueDate, gte: new Date(dueDateAfter + 'T00:00:00.000Z') };
    if (search) taskWhereClause.OR = [ { title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } } ];
    // taskWhereClause.isArchived = false; // Arşivleme eklenirse

    let taskOrderByClause = { order: 'asc', createdAt: 'desc' }; // Varsayılan
    const validSortFields = ['dueDate', 'priority', 'createdAt', 'title', 'order'];
    const orderDirection = sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    if (sortBy && validSortFields.includes(sortBy)) taskOrderByClause = { [sortBy]: orderDirection };
    // --- Bitiş ---

    const boardDetails = await prisma.board.findUnique({
      where: { id: boardId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
        tags: true,
        lists: {
          orderBy: { order: 'asc' },
          include: {
            tasks: {
              where: taskWhereClause,
              orderBy: taskOrderByClause,
              include: {
                assignees: { select: { id: true, name: true, avatarUrl: true }},
                tags: true,
                createdBy: { select: { id: true, name: true, avatarUrl: true }},
                checklistItems: {
                  orderBy: { createdAt: 'asc' },
                  include: {
                    assignees: { select: { id: true, name: true, avatarUrl: true }},
                    images: true
                  }
                },
                _count: { select: { checklistItems: true, comments: true, attachments: true } }
              }
            }
          }
        }
      }
    });

    if (!boardDetails) return res.status(404).json({ msg: 'Pano bulunamadı.' });
    res.json(boardDetails);
  } catch (err) {
      if (err instanceof Error && (err.message.includes('Invalid date') || err.message.includes('date format'))) {
        return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
    }
    console.error("getBoardById Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
   }
};

// 4. Panoya E-posta ile Üye Ekleme (Yetki: ADMIN)
exports.addMemberByEmail = async (req, res) => {
  const { boardId } = req.params;
  const { email } = req.body;
  const requestUserId = req.user.id;

  if (!email) return res.status(400).json({ msg: 'E-posta adresi gereklidir.' });

  try {
    const requestUserRole = await getUserRoleInBoard(requestUserId, boardId);
    if (!hasRequiredRole('ADMIN', requestUserRole)) {
      return res.status(403).json({ msg: 'Panoya üye ekleme yetkiniz yok (Admin değilsiniz).' });
    }

    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });

    const existingMembership = await prisma.boardMembership.findUnique({ where: { userId_boardId: { userId: userToAdd.id, boardId } } });
    if (existingMembership) return res.status(400).json({ msg: 'Kullanıcı zaten üye.' });

    const newMembership = await prisma.boardMembership.create({
      data: { userId: userToAdd.id, boardId: boardId, role: 'MEMBER' },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } }
    });

    await logActivity(requestUserId, boardId, 'ADD_BOARD_MEMBER', `"${userToAdd.name}" kullanıcısını panoya ekledi`);
    res.status(201).json(newMembership);
  } catch (err) { console.error("addMemberByEmail Hatası:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 5. Panodan Üye Çıkarma (Yetki: ADMIN)
exports.removeMember = async (req, res) => {
  const { boardId } = req.params;
  const { userIdToRemove } = req.body;
  const requestUserId = req.user.id;

  if (!userIdToRemove) return res.status(400).json({ msg: 'Çıkarılacak kullanıcı IDsi gerekli.' });

  try {
    const requestUserRole = await getUserRoleInBoard(requestUserId, boardId);
    if (!hasRequiredRole('ADMIN', requestUserRole)) {
      return res.status(403).json({ msg: 'Panodan üye çıkarma yetkiniz yok (Admin değilsiniz).' });
    }

    const board = await prisma.board.findUnique({ where: {id: boardId}, select: {createdById: true}});
    if (board && board.createdById === userIdToRemove) {
         return res.status(400).json({ msg: 'Panoyu oluşturan kişi panodan çıkarılamaz.' });
    }

    const membershipToRemove = await prisma.boardMembership.findUnique({ where: { userId_boardId: { userId: userIdToRemove, boardId } } });
    if (!membershipToRemove) return res.status(404).json({ msg: 'Kullanıcı üye değil.' });
    if (membershipToRemove.role === 'ADMIN') {
      const adminCount = await prisma.boardMembership.count({ where: { boardId: boardId, role: 'ADMIN' } });
      if (adminCount <= 1) return res.status(400).json({ msg: 'Son yöneticiyi çıkaramazsınız.' });
    }

    const userToRemoveInfo = await prisma.user.findUnique({where: {id: userIdToRemove}, select: {name: true}});
    await prisma.boardMembership.delete({ where: { userId_boardId: { userId: userIdToRemove, boardId } } });
    await logActivity(requestUserId, boardId, 'REMOVE_BOARD_MEMBER', `"${userToRemoveInfo ? userToRemoveInfo.name : 'Bir kullanıcıyı'}" panodan çıkardı`);
    res.json({ msg: 'Kullanıcı çıkarıldı.' });
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Kullanıcı bu panonun üyesi değil.' });
      console.error("removeMember Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 6. Pano Adını Güncelleme (Yetki: ADMIN)
exports.updateBoard = async (req, res) => {
  const { boardId } = req.params;
  const { name } = req.body;
  const requestUserId = req.user.id;

  if (!name || name.trim() === '') return res.status(400).json({ msg: 'Pano adı boş olamaz.' });

  try {
    const requestUserRole = await getUserRoleInBoard(requestUserId, boardId);
    if (!hasRequiredRole('ADMIN', requestUserRole)) {
      return res.status(403).json({ msg: 'Pano adını değiştirme yetkiniz yok (Admin değilsiniz).' });
    }

    const oldBoard = await prisma.board.findUnique({ where: {id: boardId}, select: { name: true}});
    if (!oldBoard) return res.status(404).json({ msg: 'Pano bulunamadı.' });

    const updatedBoard = await prisma.board.update({ where: { id: boardId }, data: { name: name.trim() } });
    if (oldBoard.name !== updatedBoard.name) {
       await logActivity(requestUserId, boardId, 'UPDATE_BOARD_NAME', `Pano adını "${oldBoard.name}" iken "${updatedBoard.name}" olarak değiştirdi`);
    }
    res.json(updatedBoard);
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Pano bulunamadı.' });
      console.error("updateBoard Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 7. PANOYU (GRUBU) SİLME (Yetki: Sadece Oluşturan Kişi)
exports.deleteBoard = async (req, res) => {
  const { boardId } = req.params;
  const requestUserId = req.user.id;

  try {
    const isCreator = await checkCreatorAccess(requestUserId, boardId);
    if (!isCreator) {
      return res.status(403).json({ msg: 'Panoyu sadece oluşturan kişi silebilir.' });
    }
    await prisma.board.delete({ where: { id: boardId } });
    // Pano silindiği için log atılmaz.
    res.json({ msg: 'Pano ve tüm içeriği başarıyla silindi.' });
  } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ msg: 'Pano bulunamadı.' });
      console.error("deleteBoard Hatası:", err.message);
      res.status(500).send('Sunucu Hatası');
     }
};

// 8. PANO İÇİNDEKİ LİSTELERİ YENİDEN SIRALAMA (Yetki: EDITOR veya üstü)
exports.reorderLists = async (req, res) => {
  const { boardId } = req.params;
  const listsOrder = req.body; // [{ listId: "id", order: number }, ...]
  const userId = req.user.id;

  if (!Array.isArray(listsOrder) || listsOrder.some(item => !item.listId || typeof item.order !== 'number')) {
      return res.status(400).json({ msg: 'Geçersiz veri formatı.' });
  }

  try {
    const userRole = await getUserRoleInBoard(userId, boardId);
    if (!hasRequiredRole('EDITOR', userRole)) {
        return res.status(403).json({ msg: 'Liste sırasını değiştirme yetkiniz yok.' });
    }

    const updatePromises = listsOrder.map(item =>
        prisma.taskList.updateMany({ where: { id: item.listId, boardId: boardId }, data: { order: item.order } })
    );
    await prisma.$transaction(updatePromises);
    await logActivity(userId, boardId, 'REORDER_LISTS', `Liste sırasını güncelledi`);
    res.json({ msg: 'Liste sırası başarıyla güncellendi.' });
  } catch (err) { console.error("reorderLists Hatası:", err.message); res.status(500).send('Sunucu Hatası'); }
};

// 9. PANO ÜYESİNİN ROLÜNÜ DEĞİŞTİRME (Yetki: ADMIN)
exports.changeMemberRole = async (req, res) => {
    const { boardId, memberUserId } = req.params;
    const { role } = req.body; // Yeni rol
    const requestUserId = req.user.id;

    const validRoles = ['ADMIN', 'EDITOR', 'MEMBER', 'COMMENTER', 'VIEWER'];
    if (!role || !validRoles.includes(role.toUpperCase())) {
        return res.status(400).json({ msg: 'Geçersiz rol belirtildi.' });
    }
    const newRole = role.toUpperCase();

    try {
        const requestUserRole = await getUserRoleInBoard(requestUserId, boardId);
        if (!hasRequiredRole('ADMIN', requestUserRole)) {
            return res.status(403).json({ msg: 'Üye rollerini değiştirme yetkiniz yok.' });
        }

        const membershipToChange = await prisma.boardMembership.findUnique({ where: { userId_boardId: { userId: memberUserId, boardId } } });
        if (!membershipToChange) return res.status(404).json({ msg: 'Kullanıcı üye değil.' });

        const board = await prisma.board.findUnique({ where: {id: boardId}, select: {createdById: true}});
        if (board && board.createdById === memberUserId) {
            return res.status(400).json({ msg: 'Panoyu oluşturan kişinin rolü değiştirilemez.' });
        }

        if (membershipToChange.role === 'ADMIN' && newRole !== 'ADMIN') {
            const adminCount = await prisma.boardMembership.count({ where: { boardId: boardId, role: 'ADMIN' } });
            if (adminCount <= 1) return res.status(400).json({ msg: 'Son yöneticinin rolünü düşüremezsiniz.' });
        }

        const updatedMembership = await prisma.boardMembership.update({
            where: { userId_boardId: { userId: memberUserId, boardId } },
            data: { role: newRole },
            include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } }
        });

        await logActivity(requestUserId, boardId, 'UPDATE_MEMBER_ROLE', `"${updatedMembership.user.name}" kullanıcısının rolünü ${newRole} olarak değiştirdi`);
        res.json(updatedMembership);

    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ msg: 'Üye veya Pano bulunamadı.' });
        console.error("changeMemberRole Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
       }
};