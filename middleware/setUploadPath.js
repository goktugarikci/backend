const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');

// Klasör adlarını güvenli hale getirmek için basit bir "slugify" fonksiyonu
const slugify = (str) => {
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Boşlukları '-' ile değiştir
    .replace(/[^\w\-]+/g, '')       // Alfanümerik olmayan karakterleri kaldır
    .replace(/\-\-+/g, '-');        // Birden fazla '-' yi tek '-' yap
};

/**
 * Bu middleware, bir 'itemId' (ChecklistItem) parametresinden yola çıkarak
 * ait olduğu 'Board' adını bulur ve güvenli bir yükleme yolu (path) oluşturur.
 * Oluşturduğu yolu 'req.boardDiskPath' ve 'req.boardUrlPath' olarak ekler.
 */
const setUploadPath = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    if (!itemId) {
      return res.status(400).json({ msg: "Checklist Item ID'si (itemId) gerekli." });
    }

    // 1. itemId'den Board adına ulaş (tek bir veritabanı sorgusuyla)
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: {
        task: {
          select: {
            taskList: {
              select: {
                board: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });

    if (!item || !item.task || !item.task.taskList || !item.task.taskList.board) {
      return res.status(404).json({ msg: 'İlişkili Pano (Board) bulunamadı.' });
    }

    const boardName = item.task.taskList.board.name;
    const safeBoardName = slugify(boardName); // "Grubun Adı" -> "grubun-adi"

    // 2. Yolları (Path) oluştur
    // Fiziksel diske yazılacak yol (örn: uploads/grubun-adi/checklist)
    const diskPath = path.join('uploads', safeBoardName, 'checklist');
    
    // Veritabanına kaydedilecek ve frontend'in erişeceği URL
    // (path.join Windows'ta '\' kullanır, URL için '/' kullanmalıyız)
    const urlPath = `/uploads/${safeBoardName}/checklist/`;

    // 3. Klasörün var olduğundan emin ol (Multer için)
    fs.mkdirSync(diskPath, { recursive: true });

    // 4. Yolları bir sonraki middleware'in (Multer) kullanabilmesi için req'e ekle
    req.boardDiskPath = diskPath;
    req.boardUrlPath = urlPath;
    
    next();

  } catch (err) {
    console.error("setUploadPath middleware hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

module.exports = setUploadPath;