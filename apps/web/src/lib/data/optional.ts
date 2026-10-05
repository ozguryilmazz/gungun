import "server-only";

/**
 * Sayfanın ana verisi olmayan bölümler (yükselenler, kaynak durumu vb.) için:
 * veri alınamazsa sayfa çökmez, bölüm "güncellenemiyor" durumunu gösterir.
 */
export async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    // Ayrıntı api-client tarafından zaten loglandı
    return null;
  }
}
