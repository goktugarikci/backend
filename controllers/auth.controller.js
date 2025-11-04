const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. YEREL KAYIT (Email/Parola)
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ msg: 'Lütfen tüm alanları doldurun' });
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      return res.status(400).json({ msg: 'Bu e-posta zaten kullanılıyor' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Yeni kullanıcı USER rolüyle oluşturulur (şemadaki varsayılan)
    user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        // role: 'USER' // Varsayılan olduğu için belirtmeye gerek yok
      },
    });

    // Token oluştur (payload'a rol ekle)
    const payload = {
      user: {
        id: user.id,
        role: user.role // Yeni kullanıcının rolü (USER)
      },
    };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: 3600 }, (err, token) => {
      if (err) throw err;
      // Yanıta rolü de ekle
      res.status(201).json({ token, role: user.role });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. YEREL GİRİŞ (Email/Parola) - GÜNCELLENDİ
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Kullanıcıyı rolüyle birlikte çek
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json({ msg: 'Geçersiz kimlik bilgileri' });
    }

    if (!user.password) {
      return res.status(400).json({ msg: 'Bu hesap Google ile oluşturulmuş. Lütfen Google ile giriş yapın veya (giriş yaptıktan sonra) hesap ayarlarınızdan bir parola belirleyin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Geçersiz kimlik bilgileri' });
    }

    // Token oluştur (payload'a 'role' ekle)
    const payload = {
      user: {
        id: user.id,
        role: user.role // <-- GÜNCELLEME: Rolü payload'a ekle
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: 3600 }, // 1 saat
      (err, token) => {
        if (err) throw err;
        // Yanıta 'role' bilgisini de ekle
        res.json({ token, role: user.role }); // <-- GÜNCELLEME: Yanıta rolü ekle
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. GOOGLE OAUTH 2.0 GERİ DÖNÜŞ (CALLBACK) KONTROLCÜSÜ - GÜNCELLENDİ
exports.googleCallback = (req, res) => {
  // Passport stratejisi (passport-setup.js) çalıştı ve 'req.user' objesini verdi
  // (req.user objesi artık veritabanından gelen rol bilgisini de içermeli)

  const payload = {
    user: {
      id: req.user.id,
      role: req.user.role // <-- GÜNCELLEME: Rolü payload'a ekle
    },
  };

  jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
    (err, token) => {
      if (err) {
          console.error("JWT imzalama hatası:", err);
          return res.redirect(`${process.env.CLIENT_URL}/login-error?error=jwt_sign_failed`);
      }
      // Kullanıcıyı token ile birlikte frontend'e yönlendir
      // Frontend, token'ı aldıktan sonra /api/user/me gibi bir endpoint'e
      // istek atarak rol ve diğer detayları ayrıca alabilir.
      res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
    }
  );
};

// 4. PAROLA AYARLAMA (Google ile girenler için)
exports.setPassword = async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id; // auth middleware'den

  if (!password || password.length < 6) {
    return res.status(400).json({ msg: 'Lütfen en az 6 karakterli bir parola girin' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.json({ msg: 'Parola başarıyla ayarlandı.' });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};