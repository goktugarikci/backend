const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/activityLogger'); // Loglama yardımcısını import et

// --- YARDIMCI GÜVENLİK/İŞLEM FONKSİYONLARI ---

// Kullanıcının bir Görev üzerinde yetkisi olup olmadığını kontrol eder
// (Bu fonksiyonun task.controller.js veya utils/accessControl.js gibi bir yerde tanımlı olduğunu varsayıyoruz)
const checkTaskAccess = async (userId, taskId) => {
  if (!userId || !taskId) return false;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { boardId: true } } },
  });
  if (!task) return false;

  const membership = await prisma.boardMembership.findUnique({
    where: { userId_boardId: { userId: userId, boardId: task.taskList.boardId } },
  });
  return !!membership;
};

// Fiziksel dosyayı silen yardımcı fonksiyon
const deletePhysicalFile = (fileUrl) => {
  if (!fileUrl) return;
  const filePath = path.join(__dirname, '..', fileUrl.replace('/uploads/', 'uploads/'));
  fs.unlink(filePath, (err) => {
    if (err) {
      // Dosya zaten yoksa hata vermesi normal olabilir, loglayalım
      if (err.code !== 'ENOENT') {
         console.error(`Dosya sisteminden ek silinemedi: ${filePath}`, err);
      }
    }
  });
};

// Hata durumunda yüklenen dosyaları siler (URL path'i alır)
const deleteUploadedFiles = (files, urlPath) => {
  if (files && Array.isArray(files) && urlPath) {
    files.forEach(file => deletePhysicalFile(urlPath + file.filename));
  }
};
// --- BİTİŞ: YARDIMCI FONKSİYONLAR ---


// 1. Bir Göreve Ek Yükleme
exports.uploadAttachments = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id; // authMiddleware'den
    const files = req.files; // Multer'dan gelen dosya dizisi
    const urlPath = req.boardUrlPath; // setAttachmentUploadPath middleware'inden

    if (!files || files.length === 0) {
        return res.status(400).json({ msg: 'Yüklenecek dosya seçilmedi.' });
    }
    if (!urlPath) {
        // Bu genellikle bir sunucu yapılandırma hatasıdır
        console.error("uploadAttachments Error: urlPath is not set by middleware.");
        deleteUploadedFiles(files, '/uploads/unknown/'); // Tahmini bir path ile silmeye çalışalım
        return res.status(500).json({ msg: 'Sunucu hatası: Yükleme yolu ayarlanamadı.' });
    }

    try {
        // Güvenlik: Kullanıcı bu göreve ek yükleyebilir mi?
        const hasAccess = await checkTaskAccess(userId, taskId);
        if (!hasAccess) {
            deleteUploadedFiles(files, urlPath); // Yetkisizse yüklenen dosyaları sil
            return res.status(403).json({ msg: 'Bu göreve ek yükleme yetkiniz yok.' });
        }

        // Görevin boardId'sini al (Loglama için)
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { title: true, taskList: { select: { boardId: true }}} // Log için title da alalım
        });
        if (!task) {
             deleteUploadedFiles(files, urlPath);
             return res.status(404).json({ msg: 'İlişkili görev bulunamadı.' });
        }
        const boardId = task.taskList.boardId;

        // Veritabanına kaydedilecek ek verilerini hazırla
        const attachmentsToCreate = files.map(file => ({
            url: urlPath + file.filename, // Dinamik URL
            fileName: file.originalname, // Orijinal dosya adını sakla
            fileType: file.mimetype,     // Dosya türünü sakla
            taskId: taskId,
            uploadedById: userId,       // Yükleyeni kaydet
        }));

        // Ekleri veritabanına kaydet
        await prisma.taskAttachment.createMany({
            data: attachmentsToCreate,
        });

        // Aktivite Logla (Her dosya için ayrı log veya toplu log)
        const fileNames = files.map(f => `"${f.originalname}"`).join(', ');
        await logActivity(
            userId,
            boardId,
            'ADD_TASK_ATTACHMENT',
            `${fileNames} eklerini "${task.title}" görevine yükledi`,
            taskId
        );

        // Başarı yanıtı olarak yeni eklenen ekleri döndür (opsiyonel)
        const createdAttachments = await prisma.taskAttachment.findMany({
            where: {
                taskId: taskId,
                // Güvenlik için sadece bu istekte yüklenenleri filtrele (URL ile)
                url: { in: attachmentsToCreate.map(a => a.url) }
            },
            include: { uploadedBy: { select: { id: true, name: true } } }
        });

        res.status(201).json(createdAttachments);

    } catch (err) {
        deleteUploadedFiles(files, urlPath); // Beklenmedik hata durumunda dosyaları sil
        console.error("Ek Yükleme Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Bir Görevin Eklerini Listeleme
exports.getAttachmentsForTask = async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user.id; // authMiddleware'den

    try {
        // Güvenlik: Kullanıcı bu görevin eklerini görebilir mi?
        const hasAccess = await checkTaskAccess(userId, taskId);
        if (!hasAccess) {
            return res.status(403).json({ msg: 'Bu görevin eklerini görme yetkiniz yok.'});
        }

        // Ekleri veritabanından çek (en yeniden eskiye)
        const attachments = await prisma.taskAttachment.findMany({
            where: { taskId: taskId },
            orderBy: { uploadedAt: 'desc' },
            include: { // Eki yükleyen kullanıcının bilgilerini dahil et
                 uploadedBy: {
                    select: { id: true, name: true, avatarUrl: true }
                 }
            }
        });
        res.json(attachments);
    } catch (err) {
        console.error("Ek Listeleme Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Bir Eki Silme
exports.deleteAttachment = async (req, res) => {
    const { attachmentId } = req.params; // Silinecek *ek* ID'si
    const userId = req.user.id; // İşlemi yapan kullanıcı

    try {
        // Silinecek eki ve ilişkili bilgileri bul
        const attachment = await prisma.taskAttachment.findUnique({
            where: { id: attachmentId },
            select: {
                url: true,          // Fiziksel dosyayı silmek için
                taskId: true,       // Yetki kontrolü için
                uploadedById: true, // Yetki kontrolü için
                fileName: true,     // Loglama için
                task: {             // Loglama için boardId'yi al
                    select: {
                        title: true, // Log mesajı için görev başlığı
                        taskList: { select: { boardId: true }}
                    }
                }
            }
        });

        if (!attachment) {
            return res.status(404).json({ msg: 'Ek bulunamadı.' });
        }
        if (!attachment.task || !attachment.task.taskList) {
             console.error(`Attachment ${attachmentId} için ilişkili görev veya liste bulunamadı.`);
             return res.status(500).send('İlişkili veri hatası.');
        }

        const boardId = attachment.task.taskList.boardId;

        // Güvenlik: Kullanıcı bu eki silebilir mi?
        // Kural: Sadece eki yükleyen kişi veya Panoyu Oluşturan kişi silebilir.
        const hasTaskAccess = await checkTaskAccess(userId, attachment.taskId); // Önce göreve erişimi var mı?
        const isOwner = attachment.uploadedById === userId; // Eki yükleyen mi?
        
        // Panoyu oluşturanı da kontrol edelim (board.controller.js'deki checkCreatorAccess benzeri)
        const board = await prisma.board.findUnique({ where: {id: boardId}, select: {createdById: true}});
        const isBoardCreator = board && board.createdById === userId;

        if (!hasTaskAccess || (!isOwner && !isBoardCreator)) { // Göreve erişimi yoksa VEYA (ek sahibi değil VE pano kurucusu değilse)
             return res.status(403).json({ msg: 'Bu eki silme yetkiniz yok.' });
        }

        // 1. Veritabanından Sil
        await prisma.taskAttachment.delete({
             where: { id: attachmentId }
        });

        // 2. Fiziksel Dosyayı Sil
        deletePhysicalFile(attachment.url);

        // Aktivite Logla
        await logActivity(
            userId,
            boardId,
            'DELETE_TASK_ATTACHMENT',
            `"${attachment.fileName}" ekini "${attachment.task.title}" görevinden sildi`,
            attachment.taskId
        );

        res.json({ msg: 'Ek başarıyla silindi.' });

    } catch (err) {
         if (err.code === 'P2025') { // Kayıt bulunamadı
            return res.status(404).json({ msg: 'Ek bulunamadı.' });
        }
        console.error("Ek Silme Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};