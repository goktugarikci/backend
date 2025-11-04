const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');
const slugify = require('../utils/slugify'); // Slugify yardımcısını import et (aşağıda)

const setAttachmentUploadPath = async (req, res, next) => {
  try {
    const { taskId } = req.params; // Rota /:taskId/attachments olmalı
    if (!taskId) {
      return res.status(400).json({ msg: "Task ID'si (taskId) gerekli." });
    }

    // taskId'den Board adına ulaş
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { taskList: { select: { board: { select: { name: true } } } } }
    });

    if (!task || !task.taskList || !task.taskList.board) {
      return res.status(404).json({ msg: 'İlişkili Pano (Board) bulunamadı.' });
    }

    const boardName = task.taskList.board.name;
    const safeBoardName = slugify(boardName);

    // Yolları oluştur (attachments alt klasörü)
    const diskPath = path.join('uploads', safeBoardName, 'attachments');
    const urlPath = `/uploads/${safeBoardName}/attachments/`;

    fs.mkdirSync(diskPath, { recursive: true });

    req.boardDiskPath = diskPath; // Multer kullanacak
    req.boardUrlPath = urlPath; // Controller kullanacak
    
    next();
  } catch (err) {
    console.error("setAttachmentUploadPath middleware hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

module.exports = setAttachmentUploadPath;