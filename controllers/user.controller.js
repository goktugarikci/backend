const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const fs = require('fs'); // Dosya işlemleri için (eski resmi silmek için)
const path = require('path');
const { getUserRoleInBoard, hasRequiredRole } = require('../utils/authorization');
// 1. ŞİFRE YENİLEME (Mevcut Şifre ile)
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id; // auth middleware'den gelen kullanıcı ID

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ msg: 'Mevcut ve yeni şifreler gerekli.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ msg: 'Yeni şifre en az 6 karakter olmalıdır.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
    }
    
    // Eğer kullanıcının yerel şifresi yoksa (Google ile girmişse)
    if (!user.password) {
        return res.status(400).json({ msg: 'Hesabınızda yerel şifre tanımlı değil. Lütfen "Şifre Belirle" özelliğini kullanın.' });
    }

    // Mevcut şifreyi kontrol et
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Mevcut şifreniz yanlış.' });
    }

    // Yeni şifreyi hash'le
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Veritabanını güncelle
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.json({ msg: 'Şifreniz başarıyla değiştirildi.' });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. İSİM DEĞİŞTİRME
exports.updateProfileName = async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;

  if (!name || name.trim() === '') {
    return res.status(400).json({ msg: 'İsim alanı boş olamaz.' });
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
      select: { id: true, email: true, name: true, avatarUrl: true } // Güncellenmiş bilgileri döndür
    });

    res.json({ msg: 'İsim başarıyla güncellendi.', user: updatedUser });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. PROFİL RESMİ EKLEME/GÜNCELLEME
exports.uploadProfileImage = async (req, res) => {
  const userId = req.user.id; // auth middleware'den
  
  // Multer'dan gelen dosya bilgisi
  if (!req.file) {
    return res.status(400).json({ msg: 'Lütfen bir resim dosyası seçin.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      // Bu durum normalde auth middleware'inden geçemez ama her ihtimale karşı.
      return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
    }

    // Eski profil resmi varsa sil
    if (user.avatarUrl) {
      // Yükleneceği klasör: 'uploads/'
      const oldImagePath = path.join(__dirname, '..', user.avatarUrl.replace('/uploads/', 'uploads/'));
      fs.unlink(oldImagePath, (err) => {
        if (err) {
          console.error("Eski resim silinirken hata oluştu (önemli değilse göz ardı edilebilir):", err);
          // Hata olsa bile devam et, yeni resim yüklensin.
        }
      });
    }

    // Yeni resmin URL'sini veritabanına kaydet
    // req.file.path: "uploads/userID-timestamp.uzantı"
    // Biz frontend'e bu resmin doğrudan erişilebilir URL'sini vermeliyiz.
    // Bu genellikle '/uploads/userID-timestamp.uzantı' şeklinde olur.
    const newAvatarUrl = '/uploads/' + req.file.filename;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: newAvatarUrl },
      select: { id: true, email: true, name: true, avatarUrl: true }
    });

    res.json({ msg: 'Profil resmi başarıyla güncellendi.', user: updatedUser });

  } catch (err) {
    console.error(err.message);
    // Yükleme sırasında bir hata olursa (multer fileFilter gibi)
    if (req.file) { // Yüklenmiş bir dosya varsa hata durumunda sil
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) console.error("Yükleme hatası sonrası dosya silinirken hata:", unlinkErr);
      });
    }
    res.status(500).send('Sunucu Hatası');
  }
};

// 4. MEVCUT KULLANICI BİLGİLERİNİ GETİRME (YENİ EKLENDİ)
exports.getMe = async (req, res) => {
  const userId = req.user.id; // authMiddleware'den gelen kullanıcı ID'si

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { // Asla şifreyi gönderme!
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        googleId: true, // Google ile bağlı olup olmadığını görmek için
        // İsteğe bağlı: Kullanıcının üye olduğu panoların ID'lerini vb. ekleyebilirsiniz
      }
    });

    if (!user) {
      // Bu durum normalde authMiddleware tarafından yakalanır ama yine de kontrol edelim
      return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
    }
    res.json(user);
  } catch (err) {
    console.error("getMe Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 5. GİRİŞ YAPMIŞ KULLANICININ ATANMIŞ GÖREVLERİNİ GETİRME (YENİ)
exports.getMyAssignedTasks = async (req, res) => {
    const userId = req.user.id; // authMiddleware'den

    // Filtreleme ve Sıralama Parametreleri
    const {
        boardId,  // Belirli bir panodaki görevleri filtrele
        status,   // approvalStatus=PENDING | APPROVED | REJECTED | NOT_REQUIRED
        priority, // priority=HIGH | NORMAL | LOW | URGENT
        isCompleted, // isCompleted=true | false (Alt görevler için değil, ana görev için düşünülebilir?) - Şemada yok, status kullanılabilir.
        dueDateBefore,
        dueDateAfter,
        sortBy,   // dueDate | priority | createdAt | title
        sortOrder // asc | desc
    } = req.query;

    try {
        // --- Dinamik Prisma Sorgu Koşulları ---
        const whereClause = {
            assigneeIds: { has: userId }, // Sadece bu kullanıcıya atanmış olanlar
            // isArchived: false, // Arşivleme eklenirse
        };

        // Filtreleri ekle
        if (boardId) {
            // Panoya erişimi var mı diye kontrol etmek iyi olabilir
            whereClause.taskList = { boardId: boardId };
        }
        if (priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority.toUpperCase())) {
            whereClause.priority = priority.toUpperCase();
        }
        if (status && ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
            whereClause.approvalStatus = status.toUpperCase();
        }
        // Bitiş Tarihi Filtreleri
        if (dueDateBefore) {
            whereClause.dueDate = { ...whereClause.dueDate, lte: new Date(dueDateBefore + 'T23:59:59.999Z') };
        }
        if (dueDateAfter) {
            whereClause.dueDate = { ...whereClause.dueDate, gte: new Date(dueDateAfter + 'T00:00:00.000Z') };
        }
        // TODO: Belki "tamamlanmamış" görevleri filtrelemek için bir durum (örn: approvalStatus != 'APPROVED') eklenebilir.

        // Sıralama Koşulu
        let orderByClause = {};
        const validSortFields = ['dueDate', 'priority', 'createdAt', 'title'];
        const orderDirection = sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';
        if (sortBy && validSortFields.includes(sortBy)) {
            orderByClause = { [sortBy]: orderDirection };
        } else {
            orderByClause = { dueDate: 'asc', createdAt: 'desc' }; // Varsayılan: Yaklaşan bitiş tarihi, sonra yeniler
        }
        // --- Bitiş: Dinamik Sorgu ---


        // Görevleri çek
        const tasks = await prisma.task.findMany({
            where: whereClause,
            orderBy: orderByClause,
            include: { // Görevle ilgili temel bilgileri ekle
                taskList: { select: { id: true, title: true, boardId: true } }, // Hangi listede/panoda?
                tags: { select: { id: true, name: true, color: true } },
                _count: { select: { checklistItems: true, comments: true, attachments: true } } // İlerleme/detay için
            }
            // Sayfalama eklenebilir (limit, skip)
        });

        res.json(tasks);

    } catch (err) {
        if (err instanceof Error && (err.message.includes('Invalid date') || err.message.includes('date format'))) {
            return res.status(400).json({ msg: 'Geçersiz tarih formatı. Lütfen YYYY-MM-DD kullanın.' });
        }
        console.error("getMyAssignedTasks Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};