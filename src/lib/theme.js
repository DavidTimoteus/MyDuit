// src/lib/theme.js
// Pengelola tema dinamis MyDuit PWA: Claymorphism (Klasik) & Neumorphism (Modern)

export const THEMES = {
  CLAYMORPHISM: 'claymorphism',
  NEUMORPHISM: 'neumorphism',
};

export const KEY_THEME = 'myduit:theme';
export const EVENT_THEME = 'myduit:theme-update';

export function temaAktif() {
  if (typeof window === 'undefined') return THEMES.NEUMORPHISM;
  try {
    const saved = localStorage.getItem(KEY_THEME);
    if (saved === THEMES.CLAYMORPHISM || saved === THEMES.NEUMORPHISM) {
      return saved;
    }
  } catch (e) {
    console.warn('[theme] Gagal membaca preferensi tema:', e);
  }
  return THEMES.NEUMORPHISM;
}

export function setTema(tema) {
  const target = tema === THEMES.CLAYMORPHISM ? THEMES.CLAYMORPHISM : THEMES.NEUMORPHISM;
  try {
    localStorage.setItem(KEY_THEME, target);
  } catch (e) {
    console.warn('[theme] Gagal menyimpan tema:', e);
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', target);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_THEME, { detail: { tema: target } }));
  }

  return target;
}

export function initTema() {
  const aktif = temaAktif();
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', aktif);
  }
  return aktif;
}
