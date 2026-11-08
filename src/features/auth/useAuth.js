import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { getFirebase } from '../../lib/firebase.js'

// status: 'loading' (cek sesi) | 'masuk' | 'keluar' | 'error'
export function useAuth() {
  const [state, setState] = useState({ status: 'loading', user: null })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (localStorage.getItem('myduit:mock_unauth')) {
          setState({ status: 'keluar', user: null })
          return () => {}
        }
        const mockFlag = window.__MYDUIT_MOCK_USER__ || localStorage.getItem('myduit:mock_user')
        if (mockFlag) {
          setState({
            status: 'masuk',
            user: {
              uid: 'demo_user_001',
              email: 'demo@myduit.app',
              displayName: 'Demo User',
              photoURL: 'https://lh3.googleusercontent.com/a/default-user',
            },
          })
          return () => {}
        }
      } catch {
        // Abaikan error akses storage pada mode terisolasi
      }
    }
    let unsub = () => {}
    try {
      const { auth } = getFirebase()
      unsub = onAuthStateChanged(auth, (user) => {
        setState({ status: user ? 'masuk' : 'keluar', user })
      })
    } catch (e) {
      setState({ status: 'error', user: null, error: e?.message ?? String(e) })
    }
    return () => unsub()
  }, [])

  return state
}
