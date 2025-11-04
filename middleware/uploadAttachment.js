const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // setAttachmentUploadPath'ten gelen dinamik yolu kullan
    if (!req.boardDiskPath) {
      return cb(new Error('Ek yükleme yolu (boardDiskPath) belirlenemedi.'), null);
    }
    cb(null, req.boardDiskPath);
  },
  filename: (req, file, cb) => {
    // Orijinal adı koruyarak ama benzersizleştirerek kaydet
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    // Güvenlik için dosya adını temizle (slugify gibi)
    const safeBaseName = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'); 
    cb(null, `${safeBaseName}-${uniqueSuffix}${ext}`);
  }
});

// Dosya filtresi (İzin verilen türleri .env'den almak daha iyi olabilir)
const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const fileFilter = (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('İzin verilmeyen dosya türü. Sadece resim, PDF, Word dosyaları.'), false);
  }
};

const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_FILES = 5; // Aynı anda yüklenecek max ek sayısı

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: MAX_FILES // Dosya sayısı limiti
  }
});

module.exports = upload.array('attachments', MAX_FILES); // Alan adı 'attachments'