const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/auth.controller');

// Standart JWT doğrulama middleware'imizi import ediyoruz
const authMiddleware = require('../middleware/auth');

// @route   POST /api/auth/register
// @desc    Yeni kullanıcı kaydı oluşturur
// @access  Public
router.post('/register', authController.register);

// @route   POST /api/auth/login
// @desc    Kullanıcı girişi yapar (E-posta/Parola)
// @access  Public
router.post('/login', authController.login);

// @route   GET /api/auth/google
// @desc    Google OAuth 2.0 kimlik doğrulama akışını başlatır
// @access  Public
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'], // Google'dan istediğimiz bilgiler
    session: false, // JWT kullandığımız için session'a gerek yok
  })
);

// @route   GET /api/auth/google/callback
// @desc    Google OAuth 2.0 geri dönüş (callback) URL'si
// @access  Public
router.get(
  '/google/callback',
  // 1. Adım: Passport isteği kontrol eder, Google'dan gelen koda bakar.
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.CLIENT_URL}/login-error`, // Hata olursa frontend'e yönlendir
  }),
  // 2. Adım: Başarılı olursa, 'authController.googleCallback' fonksiyonunu çalıştırır
  authController.googleCallback
);

// @route   PUT /api/auth/set-password
// @desc    Giriş yapmış (Google veya yerel) kullanıcının parolasını ayarlar/günceller
// @access  Private (Giriş yapmış olmayı gerektirir)
router.put(
  '/set-password',
  authMiddleware, // KORUMA: Sadece giriş yapmış kullanıcılar bu rotaya erişebilir
  authController.setPassword // Kontrolcü fonksiyonu
);

module.exports = router;