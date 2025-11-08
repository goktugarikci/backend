// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth');

// @route   POST /api/auth/register
router.post('/register', authController.register);

// @route   POST /api/auth/login
router.post('/login', authController.login);

// @route   GET /api/auth/google
// @desc    Google OAuth 2.0 akışını başlatır
// @access  Public
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'], 
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
router.put(
  '/set-password',
  authMiddleware, 
  authController.setPassword 
);

module.exports = router;