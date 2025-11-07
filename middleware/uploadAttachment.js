// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/middleware/uploadAttachment.js
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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const safeBaseName = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'); 
    cb(null, `${safeBaseName}-${uniqueSuffix}${ext}`);
  }
});

// === DÜZELTME (image_06e520.png hatası için) ===
const allowedMimeTypes = [
    'application/pdf', 
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const fileFilter = (req, file, cb) => {
  // Eğer 'image/' ile başlıyorsa VEYA izin verilenler listesindeyse
  if (file.mimetype.startsWith('image/') || allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('İzin verilmeyen dosya türü. Sadece resim, PDF, Word dosyaları.'), false);
  }
};
// === BİTİŞ ===

const MAX_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB) || 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_FILES = 5; 

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: MAX_FILES 
  }
});

module.exports = upload.array('attachments', MAX_FILES);