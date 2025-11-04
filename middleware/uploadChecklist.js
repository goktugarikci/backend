const multer = require('multer');
const path = require('path');

// Depolama ayarları (GÜNCELLENDİ)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 'setUploadPath' middleware'inin eklediği dinamik yolu kullan
    if (!req.boardDiskPath) {
      return cb(new Error('Yükleme yolu (boardDiskPath) belirlenemedi.'), null);
    }
    cb(null, req.boardDiskPath);
  },
  filename: (req, file, cb) => {
    // Dosya adı aynı kalabilir (kullanıcı ID'si ile benzersiz)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Dosya filtresi (Aynı)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Sadece resim dosyaları yüklenebilir (jpeg, png, gif)!'), false);
  }
};

// Limitler (Aynı)
const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// Multer yapılandırması (Aynı)
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES
  }
});

// Dışa aktarma (Aynı)
// 'images' -> Form data'daki alanın adı
// 5 -> Max 5 dosya
module.exports = upload.array('images', 5);