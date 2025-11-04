const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('../lib/prisma'); // Prisma client'ınızın yolu

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/auth/google/callback', // 'routes/auth.routes.js' ile eşleşmeli
      scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      // Bu, bizim 'routes' veya 'controllers' tarafından çağrılmaz.
      // Bu, 'passport.authenticate' tarafından otomatik olarak kullanılır.
      
      try {
        const email = profile.emails[0].value;
        const googleId = profile.id;

        // 1. Kullanıcı googleId ile var mı (Giriş)
        let user = await prisma.user.findUnique({ where: { googleId: googleId } });
        if (user) {
          return done(null, user); // Kullanıcıyı buldu, 'req.user' olarak ata
        }

        // 2. E-posta ile var mı (Hesap Birleştirme)
        user = await prisma.user.findUnique({ where: { email: email } });
        if (user) {
          const linkedUser = await prisma.user.update({
            where: { email: email },
            data: { googleId: googleId } // Mevcut hesaba googleId'yi ekle
          });
          return done(null, linkedUser);
        }

        // 3. Yeni kullanıcı (Kayıt)
        const newUser = await prisma.user.create({
          data: {
            googleId: googleId,
            email: email,
            name: profile.displayName,
            avatarUrl: profile.photos[0].value,
            // 'password' alanı null kalacak
          }
        });
        
        return done(null, newUser); // Yeni kullanıcıyı 'req.user' olarak ata

      } catch (err) {
        return done(err, false);
      }
    }
  )
);