const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma'); // Kullanıcının hala var olup olmadığını kontrol etmek için

/**
 * Bu middleware, rotaları korumak için kullanılır.
 * İsteğin 'Authorization' başlığından 'Bearer <token>' bilgisini okur,
 * token'ı doğrular ve kullanıcıyı 'req.user' olarak ekler.
 */
const authMiddleware = async (req, res, next) => {
  let token;

  // 1. 'Authorization' başlığını kontrol et (Bearer şeması)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Token'ı 'Bearer' kelimesinden ayır ('Bearer <token>')
      token = req.headers.authorization.split(' ')[1];

      // 2. Token'ı doğrula
      // 'verify' fonksiyonu, token geçersizse (süresi dolmuş, imza yanlış) bir hata fırlatır
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Token'ın 'payload' kısmından kullanıcı ID'sini al
      // (Token'ı oluştururken 'payload = { user: { id: user.id } }' yapmıştık)
      const userId = decoded.user.id;

      // 4. (Ekstra Güvenlik) Token geçerli olsa bile, bu ID'ye sahip 
      //    kullanıcı veritabanında hala var mı diye kontrol et.
      //    (Belki kullanıcı silinmiştir ama token'ın süresi dolmamıştır)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true } // Sadece ID'yi çekmek yeterli
      });

      if (!user) {
        return res.status(401).json({ msg: 'Kullanıcı bulunamadı, yetkilendirme reddedildi' });
      }

      // 5. Kullanıcıyı 'req' nesnesine ekle
      // Artık bu 'req'i alacak olan tüm sonraki rotalar (controller'lar)
      // 'req.user' objesine erişebilir.
      req.user = decoded.user; 

      // Her şey yolunda, isteğin bir sonraki adıma (rotanın kontrolcüsüne)
      // geçmesine izin ver.
      next();

    } catch (err) {
      // jwt.verify hata fırlattıysa (token geçersiz veya süresi dolmuşsa)
      res.status(401).json({ msg: 'Token geçerli değil veya süresi dolmuş' });
    }
  }

  // Eğer 'Authorization' başlığı yoksa veya 'Bearer' ile başlamıyorsa
  if (!token) {
    res.status(401).json({ msg: 'Token yok, yetkilendirme reddedildi' });
  }
};

module.exports = authMiddleware;