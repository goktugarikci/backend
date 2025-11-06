const prisma = require('../lib/prisma');

// --- YARDIMCI FONKSİYON: Konuşmayı Bul veya Oluştur ---
const findOrCreateConversation = async (userId1, userId2) => {
    // İki kullanıcının da dahil olduğu mevcut konuşmayı ara
    const conversation = await prisma.conversation.findFirst({
        where: {
            AND: [ // Hem user1 hem user2 katılımcı olmalı
                { participants: { some: { userId: userId1 } } },
                { participants: { some: { userId: userId2 } } },
            ]
        },
        select: { id: true }
    });

    if (conversation) {
        return conversation.id;
    }

    // Yoksa yeni konuşma oluştur
    console.log(`Yeni konuşma oluşturuluyor: ${userId1} ve ${userId2}`);
    const newConversation = await prisma.conversation.create({
        data: {
            participants: {
                create: [
                    { userId: userId1 },
                    { userId: userId2 }
                ]
            }
        },
        select: { id: true }
    });
    return newConversation.id;
};
// --- BİTİŞ: YARDIMCI FONKSİYON ---
// 1. Kullanıcının Özel Konuşmalarını Listele
exports.getConversations = async (req, res) => {
    const userId = req.user.id; // authMiddleware'den
    try {
        const participations = await prisma.conversationParticipant.findMany({
            where: { userId: userId },
            orderBy: { conversation: { updatedAt: 'desc' } },
            include: {
                conversation: {
                    include: {
                        participants: {
                            where: { userId: { not: userId } }, // Diğer katılımcı
                            include: {
                                // GÜNCELLEME: @kullanıcıadı için 'username' eklendi
                                user: { select: { id: true, name: true, avatarUrl: true, username: true } }
                            }
                        },
                        messages: { // Son mesaj
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            select: { text: true, createdAt: true, senderId: true, isRead: true, receiverId: true }
                        },
                         _count: {
                             select: {
                                 messages: {
                                     where: { receiverId: userId, isRead: false }
                                 }
                             }
                         }
                    }
                }
            }
        });

        // Yanıtı formatla
        const conversations = participations.map(p => {
            const convo = p.conversation;
            const otherParticipant = convo.participants[0]?.user;
            const lastMessage = convo.messages[0];
            const unreadCount = convo._count?.messages ?? 0;
            return {
                conversationId: convo.id,
                otherUser: otherParticipant,
                lastMessage: lastMessage,
                unreadCount: unreadCount,
                updatedAt: convo.updatedAt
            };
        }).filter(c => c.otherUser);


        res.json(conversations);
    } catch (err) {
        console.error("getConversations Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};


// 2. İki Kullanıcı Arasındaki Mesaj Geçmişini Getir (Sayfalı)
exports.getDirectMessages = async (req, res) => {
    const userId1 = req.user.id; // Giriş yapmış kullanıcı (mesajları okuyan)
    const { userId2 } = req.params; // Konuştuğu diğer kullanıcı
    
    // Sohbet penceresi her açıldığında 20 mesaj yükler (limit kaldırma yerine sonsuz kaydırma)
    const { page = 1, limit = 20 } = req.query; 
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    if (userId1 === userId2) {
        return res.status(400).json({ msg: 'Kendinizle mesajlaşamazsınız.' });
    }

    try {
        // Konuşmayı bul veya oluştur (ID'sini al)
        const conversationId = await findOrCreateConversation(userId1, userId2);

        // Mesajları çek (en yeniden eskiye doğru - 'desc')
        const messages = await prisma.directMessage.findMany({
            where: { conversationId: conversationId },
            orderBy: { createdAt: 'desc' }, // En yeni mesajlar (sayfa 1) her zaman önce gelir
            skip: skip,
            take: limitNum,
            include: {
                // GÜNCELLEME: 'username' alanı eklendi
                sender: { select: { id: true, name: true, avatarUrl: true, username: true } }
            }
        });

        // Bu konuşmadaki *bana* gelen okunmamış mesajları okundu olarak işaretle
        await prisma.directMessage.updateMany({
            where: {
                conversationId: conversationId,
                receiverId: userId1,
                isRead: false
            },
            data: { isRead: true }
        });

        // Toplam mesaj sayısı (sayfalama için)
        const totalMessages = await prisma.directMessage.count({ where: { conversationId }});

        // --- KRİTİK HATA DÜZELTMESİ (Sıralama Sorunu) ---
        // 'messages.reverse()' satırını KESİNLİKLE kaldırın.
        // Frontend'in (ChatWidget) 'reverse()' yapması için API'nin 'desc' (en yeni) sırada göndermesi gerekir.
        res.json({
            messages: messages, // .reverse() kaldırıldı
            totalMessages,
            currentPage: pageNum,
            totalPages: Math.ceil(totalMessages / limitNum)
        });
        // --- BİTİŞ ---

    } catch (err) {
        console.error(`getDirectMessages Hatası (Users: ${userId1}, ${userId2}):`, err.message);
        if (err.code === 'P2025' ) { // findOrCreateConversation içinde user bulunamazsa
             return res.status(404).json({ msg: 'Kullanıcılardan biri bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Özel Mesaj Gönder (WebSocket üzerinden tetiklenir)
// Bu fonksiyon doğrudan bir route handler değil, 'server.js' tarafından çağrılır.
exports.sendDirectMessage = async ({ senderId, receiverId, text }) => {
    // Girdi doğrulaması
    if (!senderId || !receiverId || !text || senderId === receiverId) {
        console.error("sendDirectMessage Girdi Hatası:", { senderId, receiverId, text });
        throw new Error("Geçersiz mesaj verisi: Gönderen, alıcı ve metin gereklidir ve farklı olmalıdır.");
    }

    try {
        // 1. Konuşmayı bul veya oluştur
        const conversationId = await findOrCreateConversation(senderId, receiverId);

        // 2. Mesajı veritabanına kaydet
        const newMessage = await prisma.directMessage.create({
            data: {
                text: text,
                senderId: senderId,
                receiverId: receiverId,
                conversationId: conversationId,
                isRead: false // Başlangıçta okunmadı
            },
            include: { 
                // GÜNCELLEME: Anlık gönderilen mesajın da 'username' içermesi için
                sender: { select: { id: true, name: true, avatarUrl: true, username: true } }
            }
        });

        // 3. Konuşmanın updatedAt zamanını güncelle (konuşma listesini sıralamak için)
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() }
        });


        return newMessage; // Oluşturulan mesajı (sender bilgisiyle) döndür

    } catch (err) {
        console.error(`sendDirectMessage Hatası (${senderId} -> ${receiverId}):`, err);
        if (err.code === 'P2003' || err.code === 'P2025'){ // İlişki hatası
            throw new Error("Mesaj gönderilemedi: Kullanıcı veya konuşma bulunamadı.");
        }
        throw new Error("Mesaj gönderilemedi: Sunucu hatası.");
    }
};