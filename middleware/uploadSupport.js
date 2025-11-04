const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Yükleme dizini
const uploadDir = 'uploads/support/';
fs.mkdirSync(uploadDir, { recursive: true });

// Depolama ayarları
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Giriş yapmış kullanıcının ID'sini veya rastgele bir ID kullanabiliriz
    // Anonim gönderimler olabileceği için rastgele ID daha mantıklı olabilir
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Güvenlik için kullanıcı ID'sini eklemeyelim, sadece rastgele olsun
    cb(null, 'support-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Dosya filtresi (sadece resimler)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Sadece resim dosyaları yüklenebilir (jpeg, png, gif)!'), false);
  }
};

// Limitler
const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10; // Genel limitle aynı
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_FILES = 3; // En fazla 3 resim

// Multer yapılandırması
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: MAX_FILES // Dosya sayısı limiti
  }
});

// Dışa aktarırken .array() kullanıyoruz
// 'images' -> Form data'daki alanın adı olmalı
// MAX_FILES -> Aynı anda en fazla kaç dosya
module.exports = upload.array('images', MAX_FILES);