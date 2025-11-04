const prisma = require('../lib/prisma');
const fs = require('fs'); // Dosya işlemleri için (resim silme)
const path = require('path'); // Dosya yollarını birleştirmek için

// --- GÜVENLİK YARDIMCI FONKSİYONU ---
// Kullanıcının belirli bir Task üzerinde (ve dolayısıyla checklist'i üzerinde)
// işlem yapma yetkisi var mı?
const checkTaskAccess = async (userId, taskId) => {
  if (!userId || !taskId) return null;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { boardId: true } } },
  });
  if (!task) return null; // Görev yok

  const membership = await prisma.boardMembership.findUnique({
    where: {
      userId_boardId: {
        userId: userId,
        boardId: task.taskList.boardId,
      },
    },
  });
  return membership; // Yetkisi varsa 'membership' döner, yoksa 'null' döner
};

// --- HATA YÖNETİMİ YARDIMCI FONKSİYONU ---
// Resim yükleme sırasında bir hata olursa, yüklenmiş olan dosyaları siler
const deleteUploadedFiles = (files) => {
  if (files && Array.isArray(files)) {
    files.forEach(file => {
      fs.unlink(file.path, (err) => {
        if (err) console.error(`Hata sonrası dosya silinemedi: ${file.path}`, err);
      });
    });
  }
};

// Fiziksel resim dosyasını silen yardımcı fonksiyon
const deletePhysicalFile = (fileUrl) => {
  if (!fileUrl) return;
  const filePath = path.join(__dirname, '..', fileUrl.replace('/uploads/', 'uploads/'));
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Dosya sisteminden resim silinemedi: ${filePath}`, err);
    }
  });
};


// 1. İŞLEM: Yeni Checklist Elemanı Ekleme (GÜNCELLENDİ)
exports.addChecklistItem = async (req, res) => {
  const { taskId } = req.params;
  const { text, dueDate } = req.body; // dueDate eklendi
  const userId = req.user.id;

  if (!text) {
    return res.status(400).json({ msg: 'Eleman metni gerekli.' });
  }

  try {
    const hasAccess = await checkTaskAccess(userId, taskId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu görev üzerinde işlem yetkiniz yok.' });
    }

    const newItem = await prisma.checklistItem.create({
      data: {
        text: text,
        taskId: taskId,
        dueDate: dueDate ? new Date(dueDate) : null // dueDate eklendi
      },
    });
    res.status(201).json(newItem);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 2. İŞLEM: Kontrol Tiki İşaretleme
exports.toggleChecklistItem = async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.id;

  try {
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: { taskId: true, isCompleted: true },
    });
    if (!item) {
      return res.status(404).json({ msg: 'Checklist elemanı bulunamadı.' });
    }

    const hasAccess = await checkTaskAccess(userId, item.taskId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu işlem için yetkiniz yok.' });
    }

    const updatedItem = await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        isCompleted: !item.isCompleted,
      },
    });
    res.json(updatedItem);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 3. İŞLEM: Alt Elemana Kullanıcı Atama
exports.assignToChecklistItem = async (req, res) => {
  const { itemId } = req.params;
  const { assignUserId } = req.body;
  const requestUserId = req.user.id;

  try {
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: { taskId: true },
    });
    if (!item) {
      return res.status(404).json({ msg: 'Checklist elemanı bulunamadı.' });
    }

    const hasAccess = await checkTaskAccess(requestUserId, item.taskId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu işlem için yetkiniz yok.' });
    }

    const task = await prisma.task.findUnique({
      where: { id: item.taskId },
      select: { taskList: { select: { boardId: true } } },
    });
    const assignUserMembership = await prisma.boardMembership.findUnique({
        where: { userId_boardId: { userId: assignUserId, boardId: task.taskList.boardId }}
    });
    if (!assignUserMembership) {
        return res.status(400).json({ msg: 'Atanmak istenen kullanıcı bu panonun üyesi değil.' });
    }

    const updatedItem = await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        assignees: {
          connect: { id: assignUserId },
        },
      },
      include: { assignees: { select: { id: true, name: true, avatarUrl: true }} }
    });
    res.json(updatedItem);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 4. İŞLEM: Alt Görevi Silme
exports.deleteChecklistItem = async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.id;

  try {
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: {
        taskId: true,
        images: { select: { url: true } }
      },
    });
    if (!item) {
      return res.status(404).json({ msg: 'Checklist elemanı bulunamadı.' });
    }

    const hasAccess = await checkTaskAccess(userId, item.taskId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu işlem için yetkiniz yok.' });
    }

    // 1. Fiziksel Dosyaları Sil
    if (item.images && item.images.length > 0) {
      item.images.forEach(image => deletePhysicalFile(image.url));
    }
    // 2. DB'den Sil
    await prisma.checklistItem.delete({ where: { id: itemId } });
    res.json({ msg: 'Alt görev ve bağlı resimleri başarıyla silindi.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 5. İŞLEM: Alt Görevden Kullanıcı Atamasını Kaldırma
exports.unassignFromChecklistItem = async (req, res) => {
  const { itemId } = req.params;
  const { unassignUserId } = req.body;
  const requestUserId = req.user.id;

  if (!unassignUserId) {
    return res.status(400).json({ msg: 'Ataması kaldırılacak kullanıcı IDsi gerekli.' });
  }
  try {
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: { taskId: true },
    });
    if (!item) {
      return res.status(404).json({ msg: 'Checklist elemanı bulunamadı.' });
    }

    const hasAccess = await checkTaskAccess(requestUserId, item.taskId);
    if (!hasAccess) {
      return res.status(403).json({ msg: 'Bu işlem için yetkiniz yok.' });
    }

    const updatedItem = await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        assignees: {
          disconnect: { id: unassignUserId },
        },
      },
      // Atama kaldırıldıktan sonra güncel atananları döndürmeye gerek yok
      // select: { assignees: true } // Veya boş döndür
    });
    res.json(updatedItem); // Güncellenmiş item'ı döndür
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 6. İŞLEM: Alt-Göreve Resim Ekleme (Dinamik Klasör ile)
exports.addImagesToChecklistItem = async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.id;
  const files = req.files;
  const urlPath = req.boardUrlPath;

  if (!files || files.length === 0) { /*...*/ }
  if (!urlPath) { /*...*/ }

  try {
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: {
        taskId: true,
        _count: { select: { images: true } }
      }
    });

    if (!item) { /* Hata ve dosya silme */ }
    const hasAccess = await checkTaskAccess(userId, item.taskId);
    if (!hasAccess) { /* Hata ve dosya silme */ }

    const existingImageCount = item._count.images;
    if (existingImageCount + files.length > 5) { /* Hata ve dosya silme */ }

    const imagesToCreate = files.map(file => ({
      url: urlPath + file.filename,
      checklistItemId: itemId,
    }));
    await prisma.checklistImage.createMany({ data: imagesToCreate });

    const updatedItem = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      include: {
        images: true,
        assignees: { select: { id: true, name: true, avatarUrl: true }}
      }
    });
    res.status(201).json(updatedItem);

  } catch (err) {
    deleteUploadedFiles(files);
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 7. İŞLEM: Alt-Görevden Resim Silme
exports.deleteChecklistImage = async (req, res) => {
  const { imageId } = req.params;
  const userId = req.user.id;

  try {
    const image = await prisma.checklistImage.findUnique({
      where: { id: imageId },
      select: {
        url: true,
        checklistItem: { select: { taskId: true } }
      }
    });
    if (!image || !image.checklistItem) { /* Hata */ }

    const hasAccess = await checkTaskAccess(userId, image.checklistItem.taskId);
    if (!hasAccess) { /* Hata */ }

    await prisma.checklistImage.delete({ where: { id: imageId } });
    deletePhysicalFile(image.url); // Fiziksel dosyayı da sil
    res.json({ msg: 'Resim başarıyla silindi.' });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

// 8. İŞLEM: Alt Görev Detaylarını Güncelleme (YENİ EKLENDİ - dueDate dahil)
exports.updateChecklistItem = async (req, res) => {
    const { itemId } = req.params;
    const { text, dueDate } = req.body;
    const userId = req.user.id;

    if (text === undefined && dueDate === undefined) {
        return res.status(400).json({ msg: 'Güncellenecek alan (text veya dueDate) belirtilmedi.' });
    }

    try {
        const item = await prisma.checklistItem.findUnique({
            where: { id: itemId },
            select: { taskId: true }
        });
        if (!item) {
            return res.status(404).json({ msg: 'Checklist elemanı bulunamadı.' });
        }
        const hasAccess = await checkTaskAccess(userId, item.taskId);
        if (!hasAccess) {
            return res.status(403).json({ msg: 'Bu işlem için yetkiniz yok.' });
        }

        const dataToUpdate = {};
        if (text !== undefined) {
            // Metin boş olmamalı (opsiyonel)
             if (text.trim() === '') return res.status(400).json({ msg: 'Alt görev metni boş olamaz.' });
            dataToUpdate.text = text;
        }
        if (dueDate !== undefined) {
            dataToUpdate.dueDate = dueDate ? new Date(dueDate) : null;
        }

        const updatedItem = await prisma.checklistItem.update({
            where: { id: itemId },
            data: dataToUpdate,
            include: {
                assignees: { select: { id: true, name: true, avatarUrl: true }},
                images: true
            }
        });

        res.json(updatedItem);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Sunucu Hatası');
    }
};