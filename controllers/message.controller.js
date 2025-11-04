const prisma = require('../lib/prisma');

// GÜVENLİK YARDIMCI FONKSİYONU
const checkBoardAccess = async (userId, boardId) => {
  if (!userId || !boardId) return false;
  const membership = await prisma.boardMembership.findUnique({
    where: {
      userId_boardId: {
        userId: userId,
        boardId: boardId,
      },
    },
  });
  return !!membership; // Varsa true, yoksa false döner
};

// Bir panonun (sohbet odasının) mesaj geçmişini getir
exports.getMessagesForBoard = async (req, res) => {
  const { boardId } = req.params;
  const userId = req.user.id;

  try {
    // Güvenlik: Kullanıcı bu panonun üyesi mi?
    const hasAccess = await checkBoardAccess(userId, boardId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu sohbet odasını görüntüleme yetkiniz yok.' });
    }

    const messages = await prisma.message.findMany({
      where: {
        boardId: boardId,
      },
      include: {
        // Mesaj yazarının temel bilgilerini de ekleyelim
        author: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc', // Eski mesajdan yeniye doğru sırala
      },
      take: 100, // Son 100 mesajı al (performans için)
    });

    res.json(messages);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};