/**
 * Gelen her isteğin metodunu, URL'sini ve IP adresini konsola loglayan middleware.
 */
const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString(); // İstek zamanı
  const method = req.method; // GET, POST, vb.
  const url = req.originalUrl; // İstek yapılan tam URL (/api/auth/login?param=1 gibi)
  
  // IP Adresi:
  // Eğer sunucunuz bir proxy (Nginx, Cloudflare, Heroku vb.) arkasındaysa,
  // 'trust proxy' ayarını yapıp req.ip kullanmak en doğrusudur.
  // Basit bir lokal kurulum için req.socket.remoteAddress yeterli olabilir.
  const ip = req.ip || req.socket.remoteAddress; 

  // Konsola loglama
  console.log(`[${timestamp}] ${ip} - ${method} ${url}`);

  // Bir sonraki adıma (diğer middleware veya asıl rota) geç
  next(); 
};

module.exports = requestLogger;