// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/server.js
// 1. Ortam Değişkenlerini Yükle (MUTLAKA EN ÜSTTE)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const passport = require('passport');
const path = require('path');
const http = require('http'); // Socket.io için gerekli
const { Server } = require("socket.io"); // Socket.io Server sınıfı
const jwt = require('jsonwebtoken'); // Socket auth için
const prisma = require('./lib/prisma'); // Prisma Client
const dmController = require('./controllers/directMessage.controller');
const { getUserRoleInBoard, hasRequiredRole } = require('./utils/authorization');
const { createNotification } = require('./utils/notifications'); // DM bildirimleri için

// 3. Passport (Google OAuth) Yapılandırmasını Çalıştır
require('./config/passport-setup');

// 4. Express Uygulamasını ve HTTP Sunucusunu Oluştur
const app = express();
const server = http.createServer(app); // Express'i HTTP sunucusuna sar

// 5. Socket.io Sunucusunu Başlat ve Yapılandır
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL, // Frontend adresiniz (.env dosyasından)
    methods: ["GET", "POST"]
  }
});

// 6. Socket.io Instance'ını ve Diğer Gerekli Objeleri Express Uygulamasına Ekle
app.set('socketio', io);

// 7. Genel Middleware'leri Uygula
app.use(cors({
  origin: process.env.CLIENT_URL
}));
app.use(express.json()); 
app.use(passport.initialize()); 

// İstek Loglama Middleware'i
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// 8. Statik Dosya Sunucusu (Yüklenen Resimler İçin)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 9. API Rotalarını Tanımla
app.use('/api/auth', require('./routes/auth.routes.js'));
app.use('/api/user', require('./routes/user.routes.js'));
app.use('/api/boards', require('./routes/board.routes.js'));
app.use('/api/tags', require('./routes/tag.routes.js'));
app.use('/api/tasklists', require('./routes/taskList.routes.js'));
app.use('/api/tasks', require('./routes/task.routes.js'));
app.use('/api/checklist', require('./routes/checklist.routes.js'));
app.use('/api/messages', require('./routes/message.routes.js'));   
app.use('/api/support', require('./routes/support.routes.js'));   
app.use('/api/admin', require('./routes/admin.routes.js'));     
app.use('/api', require('./routes/comment.routes.js'));         
app.use('/api', require('./routes/attachment.routes.js'));    
app.use('/api', require('./routes/activity.routes.js'));      
app.use('/api', require('./routes/reaction.routes.js'));      
app.use('/api', require('./routes/timeEntry.routes.js'));     
app.use('/api', require('./routes/view.routes.js'));          
app.use('/api', require('./routes/report.routes.js'));        
app.use('/api', require('./routes/webhook.routes.js'));       
app.use('/api', require('./routes/notification.routes.js'));  
app.use('/api/dm', require('./routes/directMessage.routes.js')); 
app.use('/api/friends', require('./routes/friend.routes.js'));


// 10. Socket.io Bağlantı Mantığı (Doğrulama, Grup Sohbeti, Özel Sohbet, Bildirimler)
const connectedUsers = {}; // { userId: socketId },
app.set('connectedUsers', connectedUsers);

io.on('connection', (socket) => {
  console.log(`Socket bağlandı: ${socket.id}`);
  let currentUserId = null; 

  // 1. Kullanıcı Kimliğini Doğrula
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUserId = decoded.user.id; 
      connectedUsers[currentUserId] = socket.id; 
      socket.join(currentUserId); // Kullanıcıyı kendi özel odasına al (DM ve Bildirimler için)
      console.log(`Kullanıcı ${currentUserId} socket ${socket.id} ile doğrulandı.`);
    } catch (err) {
      console.error(`Socket token doğrulama hatası (${socket.id}):`, err.message);
      socket.disconnect(true); 
      return; 
    }
  } else {
     console.warn(`Token olmadan socket bağlantısı denendi: ${socket.id}. Bağlantı kesiliyor.`);
     socket.disconnect(true); 
     return; 
  }

  // --- Olay Dinleyicileri (Sadece doğrulanmış kullanıcılar için çalışır) ---

  // 2. Odaya (Panoya) katılma
  socket.on('join_board', async (boardId) => {
    try {
        const userRole = await getUserRoleInBoard(currentUserId, boardId);
        if(hasRequiredRole('VIEWER', userRole)) { 
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

  // 3. Grup Mesajı gönderme
  socket.on('send_message', async (data) => {
    const { boardId, text } = data;
    const authorId = currentUserId;

    if (!boardId || !text || !authorId) {
        socket.emit('message_error', { msg: 'Eksik mesaj verisi.' }); return;
    }

    try {
      const userRole = await getUserRoleInBoard(authorId, boardId);
      if (!hasRequiredRole('COMMENTER', userRole)) {
          socket.emit('message_error', { msg: 'Bu panoya mesaj gönderme yetkiniz yok.' }); return;
      }

      const newMessage = await prisma.message.create({
        data: { text: text, boardId: boardId, authorId: authorId },
        include: { author: { select: { id: true, name: true, avatarUrl: true, username: true } } } 
      });
      io.to(boardId).emit('receive_message', newMessage);
    } catch (err) {
      console.error("Socket 'send_message' hatası:", err);
      socket.emit('message_error', { msg: "Mesaj gönderilemedi." });
    }
  });

  // 4. Özel Mesaj (DM) Gönderme
  socket.on('send_dm', async (data) => {
      const senderId = currentUserId;
      const { receiverId, text } = data;

      if (!receiverId || !text) { socket.emit('dm_error', { msg: 'Alıcı ID ve mesaj gerekli.' }); return; }
      if (senderId === receiverId) { socket.emit('dm_error', { msg: 'Kendinize mesaj gönderemezsiniz.' }); return; }

      try {
          const newMessage = await dmController.sendDirectMessage({ senderId, receiverId, text });
          socket.emit('receive_dm', newMessage); // Gönderene geri gönder
          const receiverSocketId = connectedUsers[receiverId];
          
          // === DÜZELTME: Anlık bildirim fonksiyonunu al ===
          const sendRealtimeNotification = app.get('sendRealtimeNotification'); 
          
          if (receiverSocketId) {
              io.to(receiverId).emit('receive_dm', newMessage); // Alıcının odasına gönder
          } else {
              // Alıcı online değilse SADECE DB'ye kaydet (artık anlık göndermeyi createNotification hallediyor)
              await createNotification(
                receiverId, 
                `${newMessage.sender.name} size bir mesaj gönderdi.`, 
                null, null, null,
                sendRealtimeNotification // Fonksiyonu ilet
              ); 
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
       delete connectedUsers[currentUserId]; 
    }
  });
});

// === DÜZELTME: Sizin gönderdiğiniz Anlık Bildirim Fonksiyonu ===
const sendRealtimeNotification = (userId, notificationData) => {
    if (userId && io) { 
        io.to(userId).emit('new_notification', notificationData);
        console.log(`Anlık bildirim ${userId} kullanıcısının odasına gönderildi.`);
    } else {
         console.warn(`Anlık bildirim gönderilemedi: userId (${userId}) veya io (${!!io}) eksik/hatalı.`);
    }
}
// Bu fonksiyonu app'e ekleyerek erişilebilir yapalım
app.set('sendRealtimeNotification', sendRealtimeNotification);
// === BİTİŞ: Anlık Bildirim ---

// 11. Sunucuyu Belirtilen Portta Başlat
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda başlatıldı.`));