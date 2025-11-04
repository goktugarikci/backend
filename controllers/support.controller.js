const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');

// Yardımcı Fonksiyon: Fiziksel dosyayı siler
const deletePhysicalFile = (fileUrl) => {
  if (!fileUrl) return;
  const filePath = path.join(__dirname, '..', fileUrl.replace('/uploads/', 'uploads/'));
  fs.unlink(filePath, (err) => {
    if (err) console.error(`Dosya sisteminden destek resmi silinemedi: ${filePath}`, err);
  });
};
// Yardımcı Fonksiyon: Hata durumunda yüklenen dosyaları siler
const deleteUploadedFiles = (files) => {
  if (files && Array.isArray(files)) {
    files.forEach(file => deletePhysicalFile('/uploads/support/' + file.filename));
  }
};


// 1. Kullanıcı: Yeni Destek Bileti Oluşturma
exports.createTicket = async (req, res) => {
  const { subject, description, submittedByName, submittedByEmail } = req.body;
  const files = req.files; // Yüklenen dosyalar (max 3)
  const userId = req.user?.id; // Giriş yapmışsa kullanıcı ID'si, yoksa null

  // Temel doğrulamalar
  if (!description || !submittedByName || !submittedByEmail) {
    deleteUploadedFiles(files);
    return res.status(400).json({ msg: 'İsim, E-posta ve Açıklama alanları zorunludur.' });
  }
  // Basit e-posta format kontrolü
   if (!submittedByEmail.includes('@')) {
     deleteUploadedFiles(files);
     return res.status(400).json({ msg: 'Geçerli bir e-posta adresi girin.' });
   }


  try {
    // 1. Bilet verisini hazırla
    const ticketData = {
      subject: subject || description.substring(0, 50), // Başlık yoksa açıklamadan al
      description,
      submittedByName,
      submittedByEmail,
      status: 'OPEN',
      submittedById: userId || undefined, // Eğer kullanıcı giriş yapmışsa bağla
      images: undefined // Resimler daha sonra eklenecek
    };

    // 2. Resimler varsa, resim verilerini hazırla
    let imagesToCreate = [];
    if (files && files.length > 0) {
      imagesToCreate = files.map(file => ({
        url: '/uploads/support/' + file.filename,
      }));
      // Prisma'nın nested create yapısını kullanmak için
      ticketData.images = {
          create: imagesToCreate
      };
    }

    // 3. Bileti (ve varsa resimleri) veritabanına kaydet
    const newTicket = await prisma.supportTicket.create({
      data: ticketData,
      include: { images: true } // Eklenen resimleri yanıtla döndür
    });

    // TODO: Başarılı bildirim sonrası Adminlere bir e-posta/bildirim gönderilebilir.

    res.status(201).json(newTicket);

  } catch (err) {
    deleteUploadedFiles(files); // Hata durumunda yüklenen dosyaları sil
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. Admin: Tüm Destek Biletlerini Listeleme
exports.getAllTickets = async (req, res) => {
  // TODO: Filtreleme (status, assignedAdminId) ve Sayfalama eklenebilir
  try {
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' }, // En yeniden eskiye
      include: {
        submittedBy: { select: { id: true, name: true, email: true } }, // Gönderen kullanıcı
        assignedAdmin: { select: { id: true, name: true } }, // Atanan admin
        _count: { select: { images: true, comments: true } } // Resim ve yorum sayısı
      }
    });
    res.json(tickets);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. Admin: Tek Bir Destek Biletini Detaylı Görüntüleme
exports.getTicketById = async (req, res) => {
  const { ticketId } = req.params;
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        submittedBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignedAdmin: { select: { id: true, name: true, avatarUrl: true } },
        images: true, // Tüm resimleri getir
        comments: { // Yorumları getir
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, avatarUrl: true, role: true } } // Yorum yazarını getir
          }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ msg: 'Destek bileti bulunamadı.' });
    }
    res.json(ticket);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 4. Admin: Destek Bileti Durumunu Güncelleme (ve Kapatma)
exports.updateTicketStatus = async (req, res) => {
  const { ticketId } = req.params;
  const { status } = req.body; // Yeni durum: "IN_PROGRESS", "RESOLVED", "CLOSED"

  // Gelen durumun Enum'a uygun olup olmadığını kontrol et (isteğe bağlı ama önerilir)
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
     return res.status(400).json({ msg: 'Geçersiz bilet durumu.' });
  }

  try {
    const updatedTicket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: status,
        // Eğer durum değiştiriliyorsa, atanan admini işlem yapan admin yapabiliriz (opsiyonel)
        // assignedAdminId: req.user.id
      },
    });
    res.json(updatedTicket);
  } catch (err) {
     if (err.code === 'P2025') { // Kayıt bulunamazsa
         return res.status(404).json({ msg: 'Destek bileti bulunamadı.' });
     }
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 5. Admin veya Kullanıcı: Destek Biletine Yorum Ekleme (Sohbet)
exports.addCommentToTicket = async (req, res) => {
  const { ticketId } = req.params;
  const { text } = req.body;
  const userId = req.user.id; // Yorumu yapan kişi

  if (!text) {
    return res.status(400).json({ msg: 'Yorum metni boş olamaz.' });
  }

  try {
    // Güvenlik: Yorum yapmaya çalışan kişi ya Admin olmalı ya da bileti açan kişi
    const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { submittedById: true }
    });

    if (!ticket) {
        return res.status(404).json({ msg: 'Destek bileti bulunamadı.' });
    }

    // Kullanıcının rolünü alalım
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true }});
    
    // Yetki kontrolü
    if (user.role !== 'ADMIN' && ticket.submittedById !== userId) {
        return res.status(403).json({ msg: 'Bu bilete yorum yapma yetkiniz yok.' });
    }

    // Yorumu ekle
    const newComment = await prisma.supportTicketComment.create({
      data: {
        text: text,
        ticketId: ticketId,
        authorId: userId,
      },
      include: { // Eklenen yorumu yazar bilgisiyle döndür
        author: { select: { id: true, name: true, avatarUrl: true, role: true } }
      }
    });

    // TODO: Yorum eklendiğinde ilgili kişilere (admin veya kullanıcı) bildirim gönderilebilir.

    res.status(201).json(newComment);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};