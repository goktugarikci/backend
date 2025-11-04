// 1. Ortam Değişkenlerini Yükle (MUTLAKA EN ÜSTTE)
require('dotenv').config();

// 2. Gerekli Modülleri Import Et
const express = require('express');
const cors = require('cors');
const passport = require('passport');
const path = require('path');
const http = require('http'); // Socket.io için gerekli
const { Server } = require("socket.io"); // Socket.io Server sınıfı
const jwt = require('jsonwebtoken'); // Socket auth için
const prisma = require('./lib/prisma'); // Prisma Client
const dmController = require('./controllers/directMessage.controller'); // Özel Mesaj kontrolcüsü

// 3. Passport (Google OAuth) Yapılandırmasını Çalıştır
require('./config/passport-setup');

// 4. Express Uygulamasını ve HTTP Sunucusunu Oluştur
const app = express();
const server = http.createServer(app); // Express'i HTTP sunucusuna sar

// 5. Socket.io Sunucusunu Başlat ve Yapılandır
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL, // Frontend adresiniz (.env dosyasından)
    optionsSuccessStatus: 200,
    methods: ["GET", "POST"] // İzin verilen HTTP metodları
  }
});

// 6. Socket.io Instance'ını ve Diğer Gerekli Objeleri Express Uygulamasına Ekle
// Bu sayede kontrolcüler io objesine erişebilir (örn: toplu mesaj için)
app.set('socketio', io);

// 7. Genel Middleware'leri Uygula
app.use(cors({
  origin: process.env.CLIENT_URL // Sadece belirlediğiniz frontend'den gelen isteklere izin ver
}));
app.use(express.json()); // Gelen JSON body'lerini parse et
app.use(passport.initialize()); // Passport'u başlat

// Proxy Arkasındaysanız Güven Ayarı (Opsiyonel)
// app.set('trust proxy', 1);

// İstek Loglama Middleware'i
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// 8. Statik Dosya Sunucusu (Yüklenen Resimler İçin)
// '/uploads' URL'sini projenin kök dizinindeki 'uploads/' klasörüne yönlendirir
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 9. API Rotalarını Tanımla
app.use('/api/auth', require('./routes/auth.routes.js'));
app.use('/api/user', require('./routes/user.routes.js'));
app.use('/api/boards', require('./routes/board.routes.js'));
app.use('/api/tags', require('./routes/tag.routes.js'));
app.use('/api/tasklists', require('./routes/taskList.routes.js'));
app.use('/api/tasks', require('./routes/task.routes.js'));
app.use('/api/checklist', require('./routes/checklist.routes.js'));
app.use('/api/messages', require('./routes/message.routes.js'));   // Grup sohbet geçmişi
app.use('/api/support', require('./routes/support.routes.js'));   // Destek biletleri
app.use('/api/admin', require('./routes/admin.routes.js'));     // Admin endpoint'leri
app.use('/api', require('./routes/comment.routes.js'));         // Görev yorumları (/api/tasks/:taskId/comments)
app.use('/api', require('./routes/attachment.routes.js'));    // Görev ekleri (/api/tasks/:taskId/attachments)
app.use('/api', require('./routes/activity.routes.js'));      // Aktivite logları (/api/boards/:boardId/activity)
app.use('/api', require('./routes/reaction.routes.js'));      // Reaksiyonlar (/api/tasks/:taskId/reactions)
app.use('/api', require('./routes/timeEntry.routes.js'));     // Zaman takibi (/api/tasks/:taskId/time-entries)
app.use('/api', require('./routes/view.routes.js'));          // Takvim & Zaman Çizelgesi (/api/calendar, /api/timeline)
app.use('/api', require('./routes/report.routes.js'));        // Raporlar (/api/boards/:boardId/reports)
app.use('/api', require('./routes/webhook.routes.js'));       // Webhook yönetimi (/api/webhooks)
app.use('/api', require('./routes/notification.routes.js'));  // Bildirim yönetimi (/api/notifications)
app.use('/api', require('./routes/directMessage.routes.js')); // Özel Mesaj rotaları (/api/dm/conversations)


// 10. Socket.io Bağlantı Mantığı (Doğrulama, Grup Sohbeti, Özel Sohbet, Bildirimler)
const connectedUsers = {}; // { userId: socketId }

io.on('connection', (socket) => {
  console.log(`Socket bağlandı: ${socket.id}`);
  let currentUserId = null; // Bu sokete bağlı doğrulanmış kullanıcı ID'si

  // 1. Kullanıcı Kimliğini Doğrula (Handshake sırasında token ile)
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUserId = decoded.user.id; // Token'dan userId'yi al
      connectedUsers[currentUserId] = socket.id; // Kullanıcıyı online olarak işaretle
      socket.join(currentUserId); // Kullanıcıyı kendi özel odasına al (DM ve Bildirimler için)
      console.log(`Kullanıcı ${currentUserId} socket ${socket.id} ile doğrulandı.`);
      // Opsiyonel: Kullanıcının online olduğunu yay
      // socket.broadcast.emit('user_online', currentUserId);
    } catch (err) {
      console.error(`Socket token doğrulama hatası (${socket.id}):`, err.message);
      socket.disconnect(true); // Geçersiz token ise bağlantıyı hemen kes
      return; // Fonksiyondan çık
    }
  } else {
     console.warn(`Token olmadan socket bağlantısı denendi: ${socket.id}. Bağlantı kesiliyor.`);
     socket.disconnect(true); // Token yoksa bağlantıyı kes
     return; // Fonksiyondan çık
  }

  // --- Olay Dinleyicileri (Sadece doğrulanmış kullanıcılar için çalışır) ---

  // 2. Odaya (Panoya) katılma (Grup sohbeti için)
  socket.on('join_board', async (boardId) => {
    // Güvenlik: Bu kullanıcının bu panoya erişimi var mı?
    try {
        const hasAccess = await prisma.boardMembership.findFirst({ where: { userId: currentUserId, boardId: boardId }});
        if(hasAccess) {
            socket.join(boardId);
            console.log(`Socket ${socket.id} (User: ${currentUserId}), ${boardId} odasına katıldı.`);
        } else {
             console.warn(`Yetkisiz odaya katılma denemesi: User ${currentUserId} -> Board ${boardId}`);
             socket.emit('error', { msg: `"${boardId}" odasına katılma yetkiniz yok.`});
        }
    } catch(err) {
         console.error(`join_board hatası:`, err);
         socket.emit('error', { msg: 'Odaya katılırken bir hata oluştu.'});
    }
  });

  // 3. Grup Mesajı gönderme (Grup sohbeti için)
  socket.on('send_message', async (data) => {
    // Beklenen data: { boardId: string, text: string }
    const { boardId, text } = data;
    const authorId = currentUserId;

    if (!boardId || !text || !authorId) {
        socket.emit('message_error', { msg: 'Eksik mesaj verisi.' }); return;
    }

    try {
      // Güvenlik: Kullanıcının bu panoya mesaj gönderme yetkisi var mı? (En az COMMENTER)
      const userRole = await getUserRoleInBoard(authorId, boardId); // Bu fonksiyonun utils'de olduğunu varsayıyoruz
      if (!hasRequiredRole('COMMENTER', userRole)) {
          socket.emit('message_error', { msg: 'Bu panoya mesaj gönderme yetkiniz yok.' }); return;
      }

      const newMessage = await prisma.message.create({
        data: { text: text, boardId: boardId, authorId: authorId },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } }
      });
      // Mesajı odadaki herkese (gönderen dahil) yayınla
      io.to(boardId).emit('receive_message', newMessage);
    } catch (err) {
      console.error("Socket 'send_message' hatası:", err);
      socket.emit('message_error', { msg: "Mesaj gönderilemedi." });
    }
  });

  // 4. Özel Mesaj (DM) Gönderme
  socket.on('send_dm', async (data) => {
      // Beklenen data: { receiverId: string, text: string }
      const senderId = currentUserId;
      const { receiverId, text } = data;

      if (!receiverId || !text) { /* Hata emit */ return; }
      if (senderId === receiverId) { /* Hata emit */ return; }

      try {
          // 1. Mesajı DB'ye kaydet (controller fonksiyonunu kullanarak)
          const newMessage = await dmController.sendDirectMessage({ senderId, receiverId, text });

          // 2. Mesajı gönderene geri gönder
          socket.emit('receive_dm', newMessage);

          // 3. Mesajı alıcıya gönder (eğer online ise kendi odasına - userId)
          const receiverSocketId = connectedUsers[receiverId];
          if (receiverSocketId) {
              io.to(receiverId).emit('receive_dm', newMessage); // Alıcının odasına gönder
          } else {
              // Alıcı online değilse okunmamış mesaj bildirimi oluştur
              await createNotification(receiverId, `${newMessage.sender.name} size bir mesaj gönderdi.`, null, null, null); // commentId yerine convoId?
              console.log(`Kullanıcı ${receiverId} online değil, DM bildirimi oluşturuldu.`);
          }
      } catch (error) {
          console.error("Socket 'send_dm' hatası:", error);
          socket.emit('dm_error', { msg: error.message || "Mesaj gönderilemedi." });
      }
  });

  // 5. Bağlantı Kesilmesi
  socket.on('disconnect', () => {
    console.log(`Socket ayrıldı: ${socket.id} (User: ${currentUserId})`);
    if (currentUserId && connectedUsers[currentUserId] === socket.id) {
       delete connectedUsers[currentUserId]; // Online listesinden çıkar
       // Opsiyonel: Kullanıcının offline olduğunu yay
       // socket.broadcast.emit('user_offline', currentUserId);
    }
  });
});

// --- Anlık Bildirim Gönderme Mekanizması ---
// Bu fonksiyonu utils/notifications.js içinden çağıracağız.
const sendRealtimeNotification = (userId, notificationData) => {
    if (userId && io) { // io objesinin var olduğundan emin ol
        // Kullanıcının online olup olmadığını kontrol etmeye gerek yok,
        // doğrudan kullanıcının kendi odasına (userId) gönderiyoruz.
        // Eğer bağlıysa alır, değilse almaz.
        io.to(userId).emit('new_notification', notificationData);
        console.log(`Anlık bildirim ${userId} kullanıcısının odasına gönderildi.`);
    } else {
         console.warn(`Anlık bildirim gönderilemedi: userId (${userId}) veya io (${!!io}) eksik/hatalı.`);
    }
}
// Bu fonksiyonu app'e ekleyerek erişilebilir yapalım
app.set('sendRealtimeNotification', sendRealtimeNotification);
// utils/notifications.js içindeki createNotification fonksiyonunda:
// const sendRealtimeNotification = require('../server').settings.sendRealtimeNotification; // Bu satır çalışmayabilir
// En iyi yöntem: io objesini veya bu fonksiyonu createNotification'a parametre olarak geçmek
// Veya bir Event Emitter kullanmak. Şimdilik createNotification içindeki konsol logu yeterli.

// --- BİTİŞ: Anlık Bildirim ---

// 11. Sunucuyu Belirtilen Portta Başlat
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda başlatıldı.`));

// --- Yardımcı Fonksiyonları (utils/authorization.js'den import edilmeli) ---
// Bu fonksiyonlar server.js'de değil, ilgili kontrolcülerde kullanılır.
// const { getUserRoleInBoard, hasRequiredRole } = require('./utils/authorization');