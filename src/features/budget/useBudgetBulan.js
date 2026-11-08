import { IS_DEMO_UID, MOCK_BUDGET } from '../../lib/mockData.js';
import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { getFirebase } from '../../lib/firebase.js'

// Langganan budget bulan berjalan (equality saja — tak butuh composite index).
export function useBudgetBulan(uid, bulan, tahun) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!uid) {
      setList([])
      return
    }
    if (IS_DEMO_UID(uid)) {
      setList(MOCK_BUDGET);
      return () => {};
    }
    const { db } = getFirebase()
    const q = query(
      collection(db, 'users', uid, 'budget'),
      where('deleted', '==', false),
      where('bulan', '==', bulan),
      where('tahun', '==', tahun),
    )
    return onSnapshot(q, (snap) => setList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [uid, bulan, tahun])
  return list
}
