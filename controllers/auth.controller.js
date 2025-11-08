// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/controllers/auth.controller.js
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

    // E-postadan varsayılan bir kullanıcı adı oluştur
    const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.floor(Math.random() * 9000) + 1000;
    let finalUsername = `${baseUsername}${randomSuffix}`;

    // Kullanıcı adının benzersiz olduğundan emin ol (çok düşük bir ihtimal de olsa)
    let usernameExists = await prisma.user.findUnique({ where: { username: finalUsername } });
    while (usernameExists) {
        const newSuffix = Math.floor(Math.random() * 9000) + 1000;
        finalUsername = `${baseUsername}${newSuffix}`;
        usernameExists = await prisma.user.findUnique({ where: { username: finalUsername } });
    }

    user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        username: finalUsername, // Benzersiz kullanıcı adı eklendi
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
      res.status(201).json({ token, role: user.role });
    });
  } catch (err) {
    console.error(err.message);
    if (err.code === 'P2002') { 
        return res.status(400).json({ 
            msg: 'Benzersizlik kuralı ihlali. E-posta veya kullanıcı adı zaten mevcut.',
            error: err.meta.target 
        });
    }
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. YEREL GİRİŞ (Email/Parola)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json({ msg: 'Geçersiz kimlik bilgileri' });
    }

    // DÜZELTME: Aktif olmayan kullanıcılar giriş yapamasın
    if (!user.isActive) {
         return res.status(403).json({ msg: 'Hesabınız bir yönetici tarafından devre dışı bırakıldı.' });
    }

    if (!user.password) {
      return res.status(400).json({ msg: 'Bu hesap Google ile oluşturulmuş. Lütfen Google ile giriş yapın.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Geçersiz kimlik bilgileri' });
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role 
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' }, // 1 saat
      (err, token) => {
        if (err) throw err;
        res.json({ token, role: user.role }); 
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. GOOGLE OAUTH 2.0 GERİ DÖNÜŞ (CALLBACK) KONTROLCÜSÜ
exports.googleCallback = (req, res) => {
  // passport-setup.js (yukarıdaki dosya) çalıştı ve 'req.user' objesini verdi.
  
  // DÜZELTME: Pasif kullanıcılar giriş yapamasın
  if (!req.user.isActive) {
      return res.redirect(`${process.env.CLIENT_URL}/login-error?error=account_disabled`);
  }

  const payload = {
    user: {
      id: req.user.id,
      role: req.user.role // 'role' bilgisi 'req.user' içinde mevcut
    },
  };

  jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '1h' }, // 1 saat
    (err, token) => {
      if (err) {
          console.error("JWT imzalama hatası:", err);
          return res.redirect(`${process.env.CLIENT_URL}/login-error?error=jwt_sign_failed`);
      }
      // Kullanıcıyı token ile birlikte frontend'e yönlendir
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