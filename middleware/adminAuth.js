const prisma = require('../lib/prisma');

const adminAuth = async (req, res, next) => {
  try {
    // Bu middleware'in authMiddleware'den SONRA çalışacağını varsayıyoruz
    if (!req.user || !req.user.id) {
      return res.status(401).json({ msg: 'Yetkilendirme reddedildi (Kullanıcı bulunamadı).' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true } // Sadece rol bilgisini çek
    });

    // Kullanıcı DB'de yoksa veya rolü ADMIN değilse yetkisiz
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ msg: 'Bu işlem için yönetici yetkisi gerekli.' });
    }

    // Yetkili ise devam et
    next();

  } catch (error) {
    console.error("Admin yetki kontrol hatası:", error);
    res.status(500).send('Sunucu Yetkilendirme Hatası');
  }
};

module.exports = adminAuth;