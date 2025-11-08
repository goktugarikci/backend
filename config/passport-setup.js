// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/config/passport-setup.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('../lib/prisma'); 

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/auth/google/callback', 
      scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const googleId = profile.id;

        // DÜZELTME (image_37c37d.png hatası için):
        // 'googleId' alanı unique (benzersiz) olarak işaretlenmediği için
        // 'findUnique' yerine 'findFirst' kullanıyoruz.
        let user = await prisma.user.findFirst({ where: { googleId: googleId } });
        if (user) {
          return done(null, user); // Kullanıcıyı buldu, 'req.user' olarak ata
        }

        // 2. E-posta ile var mı (Hesap Birleştirme)
        // 'email' alanı @unique olduğu için burada 'findUnique' kalabilir.
        user = await prisma.user.findUnique({ where: { email: email } });
        if (user) {
          // Yerel hesabı buldu, Google ID'sini ekliyor.
          const linkedUser = await prisma.user.update({
            where: { email: email },
            data: { googleId: googleId } 
          });
          return done(null, linkedUser);
        }

        // 3. Yeni kullanıcı (Kayıt)
        // (Not: auth.controller.js'deki register fonksiyonuna benzer bir
        // username oluşturma mantığı buraya da eklendi)
        const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        let finalUsername = `${baseUsername}${Math.floor(Math.random() * 9000) + 1000}`;
        let usernameExists = await prisma.user.findUnique({ where: { username: finalUsername } });
        while (usernameExists) {
            finalUsername = `${baseUsername}${Math.floor(Math.random() * 9000) + 1000}`;
            usernameExists = await prisma.user.findUnique({ where: { username: finalUsername } });
        }
        
        const newUser = await prisma.user.create({
          data: {
            googleId: googleId,
            email: email,
            name: profile.displayName,
            avatarUrl: profile.photos[0].value, 
            username: finalUsername // Benzersiz kullanıcı adı eklendi
          }
        });
        
        return done(null, newUser); // Yeni kullanıcıyı 'req.user' olarak ata

      } catch (err) {
        return done(err, false);
      }
    }
  )
);