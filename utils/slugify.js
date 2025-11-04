// utils/slugify.js

/**
 * Verilen metni URL ve dosya sistemi için güvenli bir 'slug' formatına dönüştürür.
 * Boşlukları tire (-) ile değiştirir, Türkçe karakterleri (şimdilik) kaldırır,
 * alfanümerik olmayan karakterleri kaldırır ve birden fazla tireyi tek tire yapar.
 * @param {string} str - Dönüştürülecek metin.
 * @returns {string} Güvenli slug formatındaki metin.
 */
const slugify = (str) => {
  if (!str) return ''; // Boş veya null ise boş döndür

  return str
    .toString()
    .toLowerCase() // Hepsini küçük harf yap
    .trim() // Başındaki ve sonundaki boşlukları kaldır
    // Türkçe karakterleri (ve diğer Latin olmayanları) şimdilik basitçe kaldırıyoruz
    // Daha gelişmiş bir kütüphane (örn: slugify npm paketi) daha iyi sonuç verebilir
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '-')           // Boşlukları tire (-) ile değiştir
    .replace(/[^\w\-]+/g, '')       // Kelime olmayan karakterleri (harf, rakam, _, - hariç) kaldır
    .replace(/\-\-+/g, '-');        // Birden fazla tireyi tek tire yap
};

module.exports = slugify; // Fonksiyonu dışa aktar