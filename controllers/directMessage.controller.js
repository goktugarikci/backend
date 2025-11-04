const prisma = require('../lib/prisma');

// --- YARDIMCI FONKSİYON: Konuşmayı Bul veya Oluştur ---
const findOrCreateConversation = async (userId1, userId2) => {
    // İki kullanıcının da dahil olduğu mevcut konuşmayı ara
    // Performansı artırmak için önce daha spesifik bir arama yapılabilir (katılımcı sayısı kontrolü vb.)
    const conversation = await prisma.conversation.findFirst({
        where: {
            AND: [ // Hem user1 hem user2 katılımcı olmalı
                { participants: { some: { userId: userId1 } } },
                { participants: { some: { userId: userId2 } } },
                // Teorik olarak sadece 2 katılımcı olmalı ama Prisma'da bunu doğrudan filtrelemek zor.
                // Uygulama katmanında kontrol edilebilir veya '_count' kullanılabilir.
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
                                user: { select: { id: true, name: true, avatarUrl: true } }
                            }
                        },
                        messages: { // Son mesaj
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            select: { text: true, createdAt: true, senderId: true, isRead: true, receiverId: true } // Okundu bilgisi ve alıcı eklendi
                        },
                        // Okunmamış mesaj sayısı (bu kullanıcıya gelen)
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
            const unreadCount = convo._count?.messages ?? 0; // Okunmamış mesaj sayısı
            return {
                conversationId: convo.id,
                otherUser: otherParticipant,
                lastMessage: lastMessage,
                unreadCount: unreadCount, // Okunmamış mesaj sayısını ekle
                updatedAt: convo.updatedAt
            };
        }).filter(c => c.otherUser); // Katılımcısı olmayanları filtrele


        res.json(conversations);
    } catch (err) {
        console.error("getConversations Hatası:", err.message);
        res.status(500).send('Sunucu Hatası'); // Genel sunucu hatası
    }
};


// 2. İki Kullanıcı Arasındaki Mesaj Geçmişini Getir (Sayfalı)
exports.getDirectMessages = async (req, res) => {
    const userId1 = req.user.id; // Giriş yapmış kullanıcı (mesajları okuyan)
    const { userId2 } = req.params; // Konuştuğu diğer kullanıcı
    const { page = 1, limit = 30 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    if (userId1 === userId2) {
        return res.status(400).json({ msg: 'Kendinizle mesajlaşamazsınız.' });
    }

    try {
        // Konuşmayı bul veya oluştur (ID'sini al)
        const conversationId = await findOrCreateConversation(userId1, userId2);

        // Mesajları çek (en yeniden eskiye doğru - sohbet ekranı mantığı)
        const messages = await prisma.directMessage.findMany({
            where: { conversationId: conversationId },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limitNum,
            include: {
                sender: { select: { id: true, name: true, avatarUrl: true } } // Gönderen bilgisi
            }
        });

        // Bu konuşmadaki *bana* gelen okunmamış mesajları okundu olarak işaretle
        // Bu işlem mesajlar çekildikten sonra yapılmalı ki kullanıcı arayüzü güncellensin
        await prisma.directMessage.updateMany({
            where: {
                conversationId: conversationId,
                receiverId: userId1, // Alıcısı benim
                isRead: false
            },
            data: { isRead: true }
        });

        // Toplam mesaj sayısı (sayfalama için)
        const totalMessages = await prisma.directMessage.count({ where: { conversationId }});

        // Mesajları ters çevir (eskiden yeniye) - frontend genellikle bunu ister
        res.json({
            messages: messages.reverse(),
            totalMessages,
            currentPage: pageNum,
            totalPages: Math.ceil(totalMessages / limitNum)
        });

    } catch (err) {
        console.error(`getDirectMessages Hatası (Users: ${userId1}, ${userId2}):`, err.message);
        if (err.code === 'P2025' ) { // findOrCreateConversation içinde user bulunamazsa
             return res.status(404).json({ msg: 'Kullanıcılardan biri bulunamadı.' });
        }
        res.status(500).send('Sunucu Hatası');
    }
};

// 3. Özel Mesaj Gönder (WebSocket üzerinden tetiklenir veya REST API)
// Bu fonksiyon doğrudan bir route handler değil, WebSocket tarafından çağrılır.
// Hata fırlatır, çağıran yer (örn: WebSocket handler) yakalamalıdır.
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
            include: { // WebSocket yayını için gönderen bilgisini ekle
                sender: { select: { id: true, name: true, avatarUrl: true } }
            }
        });

        // 3. Konuşmanın updatedAt zamanını güncelle (konuşma listesini sıralamak için)
        // Bu, mesaj oluşturulduktan sonra yapılmalı
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() }
        });


        return newMessage; // Oluşturulan mesajı döndür

    } catch (err) {
        console.error(`sendDirectMessage Hatası (${senderId} -> ${receiverId}):`, err);
        // Prisma ile ilgili spesifik hatalar daha detaylı loglanabilir
        if (err.code === 'P2003' || err.code === 'P2025'){ // İlişki hatası (user/convo bulunamadı)
            throw new Error("Mesaj gönderilemedi: Kullanıcı veya konuşma bulunamadı.");
        }
        throw new Error("Mesaj gönderilemedi: Sunucu hatası."); // Genel hata
    }
};