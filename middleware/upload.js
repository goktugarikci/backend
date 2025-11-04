const multer = require('multer');
const path = require('path');

// ... (storage: multer.diskStorage kısmı aynı kalabilir)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});


// Sadece belirli dosya türlerine izin ver
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/gif') {
    cb(null, true); // Kabul et
  } else {
    // new Error() fırlatmak, rotadaki hata yakalayıcının (error handler) bunu yakalamasını sağlar
    cb(new Error('Sadece JPEG, PNG veya GIF formatında resimler yüklenebilir.'), false);
  }
};

// --- GÜNCELLEME BURADA ---

// 1. Yükleme sınırını .env dosyasından al
// Eğer .env'de tanımlı değilse (veya hatalıysa), varsayılan olarak 10 MB kullan
const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10;

// 2. MB'ı Bayt'a (Byte) çevir
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// 3. Multer yapılandırmasına dinamik limiti ekle
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES // Limiti buradan dinamik olarak ayarla
  }
});

module.exports = upload;