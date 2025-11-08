// goktugarikci/backend/backend-70a9cc108f7867dd5c32bdc20b3c16149bc11d0d/controllers/friend.controller.js
const prisma = require('../lib/prisma');
const { createNotification } = require('../utils/notifications');

/**
 * 1. Arkadaşlık İsteği Gönderme (Kullanıcı Adı veya E-posta ile)
 * @route POST /api/friends/request
 */
exports.sendFriendRequest = async (req, res) => {
  const { identifier } = req.body; // 'identifier' = email veya username
  const requesterId = req.user.id;

  if (!identifier) {
    return res.status(400).json({ msg: 'Kullanıcı adı veya e-posta gereklidir.' });
  }

  try {
    // 1. Alıcıyı bul
    const receiver = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier }
        ]
      },
      select: { id: true, name: true }
    });

    if (!receiver) {
      return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
    }

    if (receiver.id === requesterId) {
      return res.status(400).json({ msg: 'Kendinize arkadaşlık isteği gönderemezsiniz.' });
    }

    // 2. Mevcut bir ilişki var mı kontrol et (her iki yönde de)
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { requesterId: requesterId, receiverId: receiver.id },
          { requesterId: receiver.id, receiverId: requesterId }
        ]
      }
    });

    if (existingRequest) {
      if (existingRequest.status === 'ACCEPTED') {
        return res.status(400).json({ msg: 'Bu kullanıcıyla zaten arkadaşsınız.' });
      }
      if (existingRequest.status === 'PENDING') {
        return res.status(400).json({ msg: 'Daha önce bir istek gönderilmiş.' });
      }
      // Eğer 'DECLINED' ise, eski isteği silip yenisine izin ver
      if (existingRequest.status === 'DECLINED') {
          await prisma.friendRequest.delete({ where: { id: existingRequest.id }});
      }
    }
    
    // 3. Yeni istek oluştur
    const newRequest = await prisma.friendRequest.create({
      data: {
        requesterId: requesterId,
        receiverId: receiver.id,
        status: 'PENDING'
      }
    });

// 4. Alıcıya bildirim gönder
    const requesterUser = await prisma.user.findUnique({ where: { id: requesterId }, select: { name: true }});
    
    // DÜZELTME: Anlık Bildirim Gönder
    const sendRealtimeNotification = req.app.get('sendRealtimeNotification');
    await createNotification(
      receiver.id,
      `"${requesterUser.name}" size bir arkadaşlık isteği gönderdi.`,
      null, null, null,
      sendRealtimeNotification // Soket fonksiyonunu ilet
    );
    
    // DÜZELTME: Anlık Bildirim Gönder
    if (notification) {
      const sendRealtimeNotification = req.app.get('sendRealtimeNotification');
      if (sendRealtimeNotification) {
          sendRealtimeNotification(receiver.id, notification);
      }
    }

    res.status(201).json(newRequest);

  } catch (err) {
    console.error("sendFriendRequest Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

/**
 * 2. Bekleyen Arkadaşlık İsteklerini Listeleme
 * @route GET /api/friends/requests
 */
exports.listPendingRequests = async (req, res) => {
  const userId = req.user.id;
  try {
    // Bana gelen ve bekleyen istekler
    const received = await prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: 'PENDING'
      },
      include: {
        requester: { // İsteği gönderenin bilgisini al
          select: { id: true, name: true, username: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Benim gönderdiğim ve bekleyen istekler
    const sent = await prisma.friendRequest.findMany({
      where: {
        requesterId: userId,
        status: 'PENDING'
      },
      include: {
        receiver: { // İsteği alanın bilgisini al
          select: { id: true, name: true, username: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ received, sent });

  } catch (err) {
    console.error("listPendingRequests Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

/**
 * 3. Arkadaşlık İsteğini Yanıtlama (Kabul veya Red)
 * @route PUT /api/friends/requests/:requestId
 */
exports.respondToRequest = async (req, res) => {
  const { requestId } = req.params;
  const { response } = req.body; // 'ACCEPT' veya 'DECLINE'
  const receiverId = req.user.id; // İsteği yanıtlayan kişi

  if (!['ACCEPT', 'DECLINE'].includes(response)) {
    return res.status(400).json({ msg: 'Geçersiz yanıt (ACCEPT veya DECLINE olmalı).' });
  }

  try {
    // 1. İsteği bul ve yetkiyi kontrol et
    const request = await prisma.friendRequest.findFirst({
      where: {
        id: requestId,
        receiverId: receiverId, // Sadece isteği alan kişi yanıtlayabilir
        status: 'PENDING'     // Sadece bekleyen istekler yanıtlanabilir
      }
    });

    if (!request) {
      return res.status(404).json({ msg: 'Yanıtlanacak bekleyen istek bulunamadı.' });
    }
    
    const { requesterId } = request;

    if (response === 'ACCEPT') {
      // 2. İsteği KABUL ET
      await prisma.$transaction([
        // 2a. İsteğin durumunu 'ACCEPTED' yap
        prisma.friendRequest.update({
          where: { id: requestId },
          data: { status: 'ACCEPTED' }
        }),
        // 2b. Alıcıyı, gönderenin arkadaş listesine ekle
        prisma.user.update({
          where: { id: requesterId },
          data: { friends: { connect: { id: receiverId } } }
        }),
        // 2c. Göndereni, alıcının arkadaş listesine ekle
        prisma.user.update({
          where: { id: receiverId },
          data: { friends: { connect: { id: requesterId } } }
        })
      ]);
      
      // Bildirim gönder
      const receiverUser = await prisma.user.findUnique({ where: { id: receiverId }, select: { name: true }});
      
// DÜZELTME: Anlık Bildirim Gönder
      const sendRealtimeNotification = req.app.get('sendRealtimeNotification');
      await createNotification(
          requesterId, 
          `"${receiverUser.name}" arkadaşlık isteğinizi kabul etti!`, 
          null, null, null,
          sendRealtimeNotification // Soket fonksiyonunu ilet
      );
      
      res.json({ msg: 'Arkadaşlık isteği kabul edildi.' });

    } else {
      await prisma.friendRequest.delete({ where: { id: requestId } });
      res.json({ msg: 'Arkadaşlık isteği reddedildi.' });
    }

  } catch (err) {
    console.error("respondToRequest Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};
/**
 * 4. Arkadaş Listesini Getirme (Online Statü ile)
 * @route GET /api/friends
 */
exports.listFriends = async (req, res) => {
  const userId = req.user.id;
  
  // server.js'de app.set() ile kaydettiğimiz anlık bağlı kullanıcı listesini al
  const connectedUsers = req.app.get('connectedUsers') || {};

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        friends: { // Sadece arkadaş listesini çek
          select: {
            id: true,
            name: true,
            username: true,
            avatarUrl: true
          },
          orderBy: { name: 'asc' } // Alfabetik sırala
        }
      }
    });

    if (!user) {
      return res.status(404).json({ msg: 'Kullanıcı bulunamadı.' });
    }

    // Arkadaş listesini map'leyerek 'isOnline' durumu ekle
    const friendsWithStatus = user.friends.map(friend => ({
      ...friend,
      // 'connectedUsers' objesinde bu arkadaşın ID'si var mı diye kontrol et
      isOnline: connectedUsers.hasOwnProperty(friend.id) 
    }));
    
    // 'isOnline' durumuna göre sırala (Önce çevrimiçi olanlar)
    friendsWithStatus.sort((a, b) => {
        if (a.isOnline && !b.isOnline) return -1; // a (online) üste gelsin
        if (!a.isOnline && b.isOnline) return 1; // b (online) üste gelsin
        return 0; // Kendi içlerinde (online/offline) alfabetik kalsınlar
    });

    res.json(friendsWithStatus);

  } catch (err) {
    console.error("listFriends Hatası:", err.message);
    res.status(500).send('Sunucu Hatası');
  }
};

/**
 * 5. Arkadaş Silme (Unfriend)
 * @route DELETE /api/friends/:friendId
 */
exports.removeFriend = async (req, res) => {
  const { friendId } = req.params; // Silinmek istenen arkadaşın ID'si
  const userId = req.user.id; // İşlemi yapan kişi

  if (friendId === userId) {
    return res.status(400).json({ msg: 'Kendinizi arkadaşlıktan çıkaramazsınız.' });
  }

  try {
    await prisma.$transaction([
      // 1. Arkadaşlık ilişkisini benden kaldır
      prisma.user.update({
        where: { id: userId },
        data: { friends: { disconnect: { id: friendId } } }
      }),
      // 2. Arkadaşlık ilişkisini ondan kaldır
      prisma.user.update({
        where: { id: friendId },
        data: { friends: { disconnect: { id: userId } } }
      }),
      // 3. Aradaki 'FriendRequest' kaydını (ACCEPTED veya diğer) sil
      prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { requesterId: userId, receiverId: friendId },
            { requesterId: friendId, receiverId: userId }
          ]
        }
      })
    ]);

    res.json({ msg: 'Arkadaşlıktan çıkarıldı.' });

  } catch (err) {
    console.error("removeFriend Hatası:", err.message);
    // P2025: Kayıt bulunamadı (Zaten arkadaş değillerse)
    if (err.code === 'P2025') {
        // Bu bir hata değil, işlem zaten gerçekleşmiş
        return res.json({ msg: 'Kullanıcıyla zaten arkadaş değilsiniz.' });
    }
    res.status(500).send('Sunucu Hatası');
  }
};