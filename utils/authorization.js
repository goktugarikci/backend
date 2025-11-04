const prisma = require('../lib/prisma');

/**
 * Kullanıcının belirli bir panodaki rolünü getirir.
 * @param {string} userId Kullanıcı ID'si
 * @param {string} boardId Pano ID'si
 * @returns {Promise<string | null>} Kullanıcının rolünü (örn: 'ADMIN', 'MEMBER') veya üye değilse null döner.
 */
const getUserRoleInBoard = async (userId, boardId) => {
    if (!userId || !boardId) return null;
    try {
        const membership = await prisma.boardMembership.findUnique({
            where: { userId_boardId: { userId, boardId } },
            select: { role: true } // Sadece rolü çek
        });
        return membership?.role ?? null; // Rolü veya null döndür
    } catch (error) {
        console.error(`Error fetching user role for user ${userId} in board ${boardId}:`, error);
        return null; // Hata durumunda null döndür
    }
};

/**
 * Kullanıcının belirli bir eylemi gerçekleştirmek için yeterli role sahip olup olmadığını kontrol eder.
 * @param {string} requiredRole - Gerekli minimum rol (örn: 'EDITOR'). Roller güç sırasına göre olmalı (ADMIN > EDITOR > MEMBER > COMMENTER > VIEWER).
 * @param {string} userRole - Kullanıcının mevcut rolü.
 * @returns {boolean} Yetkisi varsa true, yoksa false döner.
 */
const hasRequiredRole = (requiredRole, userRole) => {
    if (!userRole) return false; // Kullanıcının rolü yoksa (üye değilse) yetkisi yoktur.

    const rolesHierarchy = ['VIEWER', 'COMMENTER', 'MEMBER', 'EDITOR', 'ADMIN']; // Güç sırası (en düşükten en yükseğe)

    const requiredIndex = rolesHierarchy.indexOf(requiredRole);
    const userIndex = rolesHierarchy.indexOf(userRole);

    // Eğer roller tanımlıysa ve kullanıcının rol indeksi gerekli rol indeksinden büyük veya eşitse yetkilidir.
    return requiredIndex !== -1 && userIndex !== -1 && userIndex >= requiredIndex;
};

module.exports = { getUserRoleInBoard, hasRequiredRole };