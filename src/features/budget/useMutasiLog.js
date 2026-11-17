// Langganan live ke koleksi mutasiLog (append-only) untuk menu Budget.
// Sengaja tidak pakai orderBy di query supaya tidak butuh composite index;
// pengurutan dilakukan di mutasiKoreksi.js beserta penggabungan data legacy.
import { useEffect, useState } from 'react'
import { limit, onSnapshot, query, where } from 'firebase/firestore'
import { userCol } from '../../lib/db.js'
import { IS_DEMO_UID } from '../../lib/mockData.js'

const BATAS = 200

export function useMutasiLog(uid) {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    if (!uid || IS_DEMO_UID(uid)) {
      setLogs([])
      return undefined
    }
    const q = query(userCol(uid, 'mutasiLog'), where('deleted', '==', false), limit(BATAS))
    return onSnapshot(
      q,
      (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => console.warn('[mutasiLog] gagal memuat:', e?.message ?? e),
    )
  }, [uid])

  return logs
}
