const prisma = require('../lib/prisma');

// --- YARDIMCI GÜVENLİK FONKSİYONU ---
// Kullanıcının bir Pano (Board) üzerinde yetkisi olup olmadığını kontrol eder
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
  
  // '!!membership' -> Eğer üyelik varsa true, yoksa false döner
  return !!membership; 
};

// 1. Bir Panoya Yeni Etiket Oluştur
exports.createTag = async (req, res) => {
  const { name, color, boardId } = req.body;
  const userId = req.user.id; // İstek yapan kullanıcı

  if (!name || !color || !boardId) {
    return res.status(400).json({ msg: 'İsim (name), renk (color) ve Pano ID (boardId) gereklidir.' });
  }

  try {
    // Güvenlik: Kullanıcı bu panonun üyesi mi?
    const hasAccess = await checkBoardAccess(userId, boardId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu panoya etiket ekleme yetkiniz yok.' });
    }

    // İşlem: Yeni etiketi oluştur
    const newTag = await prisma.tag.create({
      data: {
        name,
        color,
        boardId, // Hangi panoya ait olduğunu belirt
      },
    });
    
    res.status(201).json(newTag);

  } catch (err) {
    // Prisma P2002: Benzersiz kısıtlama hatası
    // (schema.prisma'da @@unique([name, boardId]) tanımlamıştık)
    if (err.code === 'P2002') {
      return res.status(400).json({ msg: 'Bu panoda bu isimde bir etiket zaten var.' });
    }
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. Bir Etiketi Sil
exports.deleteTag = async (req, res) => {
  const { tagId } = req.params; // Silinecek etiketin ID'si
  const userId = req.user.id;

  try {
    // Güvenlik: Etiketi bul ve hangi panoya ait olduğunu öğren
    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { boardId: true }, // Sadece boardId'sini çek
    });

    if (!tag) {
      return res.status(404).json({ msg: 'Etiket bulunamadı.' });
    }

    // Kullanıcı, bu etiketin ait olduğu panoya üye mi?
    const hasAccess = await checkBoardAccess(userId, tag.boardId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu etiketi silme yetkiniz yok.' });
    }

    // İşlem: Etiketi sil
    // (Bu etiket görevlerde (Task) kullanılıyorsa, Prisma otomatik olarak
    // o görevlerin 'tagIds' listesinden bu ID'yi kaldıracaktır)
    await prisma.tag.delete({
      where: { id: tagId },
    });
    
    res.json({ msg: 'Etiket başarıyla silindi.' });
    
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};