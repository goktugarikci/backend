const prisma = require('../lib/prisma');

// --- YARDIMCI GÜVENLİK FONKSİYONLARI ---
// (Bu fonksiyonların board.controller.js ve task.controller.js'de tanımlı olduğunu varsayıyoruz.
// Alternatif olarak, bunları ayrı bir 'utils/accessControl.js' dosyasına taşıyıp import edebilirsiniz.)

// Kullanıcının bir Pano üzerinde yetkisi olup olmadığını kontrol eder
const checkBoardAccess = async (userId, boardId) => {
  if (!userId || !boardId) return false;
  const membership = await prisma.boardMembership.findUnique({
    where: { userId_boardId: { userId: userId, boardId: boardId } },
  });
  return !!membership;
};

// Kullanıcının bir Görev üzerinde yetkisi olup olmadığını kontrol eder
const checkTaskAccess = async (userId, taskId) => {
  if (!userId || !taskId) return false;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { boardId: true } } },
  });
  if (!task) return false;
  return await checkBoardAccess(userId, task.taskList.boardId);
};
// --- BİTİŞ: YARDIMCI FONKSİYONLAR ---


// 1. Bir Panonun Aktivitelerini Getir (Sayfalı)
exports.getActivityForBoard = async (req, res) => {
    const { boardId } = req.params;
    const userId = req.user.id; // authMiddleware'den

    // Sayfalama için Query parametreleri (varsayılan değerlerle)
    const page = parseInt(req.query.page) || 1; // Sayfa numarası (varsayılan 1)
    const limit = parseInt(req.query.limit) || 20; // Sayfa başına öğe sayısı (varsayılan 20)
    const skip = (page - 1) * limit; // Atlanacak öğe sayısı

    try {
        // Güvenlik: Kullanıcı bu panoya erişebilir mi?
        const hasAccess = await checkBoardAccess(userId, boardId);
        if (!hasAccess) {
            return res.status(403).json({ msg: 'Bu panonun aktivitelerini görme yetkiniz yok.'});
        }

        // Aktiviteleri veritabanından çek (en yeniden eskiye)
        const activities = await prisma.activityLog.findMany({
            where: { boardId: boardId }, // Sadece bu panoya ait olanlar
            orderBy: { timestamp: 'desc' }, // En yeniden eskiye sırala
            skip: skip, // Sayfalama için atla
            take: limit, // Sayfalama için al
            include: { // İlişkili verileri dahil et
                user: { // Aktiviteyi yapan kullanıcı (temel bilgiler)
                    select: { id: true, name: true, avatarUrl: true }
                },
                task: { // Aktivitenin ilgili olduğu görev (varsa, temel bilgiler)
                    select: { id: true, title: true }
                }
                // İsteğe bağlı: taskList, comment gibi diğer ilişkiler de eklenebilir
            }
        });
        
        // Toplam aktivite sayısını al (toplam sayfa sayısını hesaplamak için)
        const totalActivities = await prisma.activityLog.count({ where: { boardId: boardId }});
        
        // Yanıtı oluştur
        res.json({
            activities,
            totalActivities,
            currentPage: page,
            totalPages: Math.ceil(totalActivities / limit) // Toplam sayfa sayısı
        });

    } catch (err) {
        console.error("Board Aktivite Getirme Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
    }
};

// 2. Bir Görevin Aktivitelerini Getir (Sayfalı)
exports.getActivityForTask = async (req, res) => {
     const { taskId } = req.params;
     const userId = req.user.id; // authMiddleware'den
     const page = parseInt(req.query.page) || 1;
     const limit = parseInt(req.query.limit) || 10; // Görev detayı için daha az log (varsayılan 10)
     const skip = (page - 1) * limit;

     try {
        // Güvenlik: Kullanıcı bu göreve (ve dolayısıyla panoya) erişebilir mi?
        const hasAccess = await checkTaskAccess(userId, taskId);
        if (!hasAccess) {
            return res.status(403).json({ msg: 'Bu görevin aktivitelerini görme yetkiniz yok.'});
        }

        // Aktiviteleri çek
        const activities = await prisma.activityLog.findMany({
            where: { taskId: taskId }, // Sadece bu görevle ilgili olanlar
            orderBy: { timestamp: 'desc' },
            skip: skip,
            take: limit,
            include: {
                user: { // Aktiviteyi yapan kullanıcı
                     select: { id: true, name: true, avatarUrl: true }
                },
                // Görev zaten bilindiği için tekrar task'ı include etmeye gerek yok
                // İsteğe bağlı: Yorum gibi diğer ilişkili detaylar eklenebilir
                // comment: { select: { id: true, text: true } }
            }
        });

        // Toplam aktivite sayısını al
        const totalActivities = await prisma.activityLog.count({ where: { taskId: taskId }});

        // Yanıtı oluştur
        res.json({
            activities,
            totalActivities,
            currentPage: page,
            totalPages: Math.ceil(totalActivities / limit)
        });

     } catch (err) {
        console.error("Task Aktivite Getirme Hatası:", err.message);
        res.status(500).send('Sunucu Hatası');
     }
};