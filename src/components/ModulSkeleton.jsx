/**
 * ModulSkeleton — fallback saat tab dimuat.
 *
 * Shell memuat 4 modul secara lazy; sekarang tab pertama yang dibuka harus
 * menunggu chunk-nya turun (di jaringan seluler bisa 1–2 detik). Tanpa
 * placeholder, area konten mendadak kosong dan layout melompat begitu modul
 * muncul — terutama di mobile, di mana konten adalah satu-satunya
 * yang terlihat.
 *
 * Skeleton ini memakai komponen clay yang sama dengan modul aslinya:
 * bentuk kartu, radius, dan tinggi baris dibuat mendekati supaya transisi
 * loading -> berisi tidak terasa melompat. Bukan spinner: spinner di tengah
 * area konten terbaca seperti error, sedangkan skeleton memberi kesan
 * "hampir jadi".
 */
export default function ModulSkeleton() {
  // Tinggi baris didekati dengan modul list nyata (+-52px per baris) supaya
  // saat isi muncul tinggi halaman tidak melompat.
  const rows = [0, 1, 2, 3, 4, 5, 6, 7]

  return (
    <div className="mx-auto mt-6 max-w-3xl px-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Memuat modul…</span>

      {/* Placeholder toolbar */}
      <div className="clay-card-soft mb-4 flex items-center gap-3 px-4 py-3">
        <div className="neu-skeleton-shimmer h-4 w-32 rounded-full" />
        <div className="neu-skeleton-shimmer ml-auto h-9 w-24 rounded-full" />
      </div>

      {/* Placeholder baris data */}
      <div className="flex flex-col gap-2.5">
        {rows.map((i) => (
          <div
            key={i}
            className="clay-card-soft flex items-center gap-3 px-4 py-3.5"
            style={{ opacity: 1 - i * 0.08 }}
          >
            <div className="neu-skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="neu-skeleton-shimmer h-3.5 w-2/5 rounded-full" />
              <div className="neu-skeleton-shimmer mt-2 h-3 w-3/5 rounded-full" />
            </div>
            <div className="neu-skeleton-shimmer h-4 w-20 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}