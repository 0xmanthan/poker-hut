import { useEffect, useState } from 'react';

// Each theme restyles the whole room: felt, rail, cards, card backs and chips.
// All of it is CSS (see [data-theme] blocks in styles.css); this only picks one.
export const THEMES = [
  { id: 'heirloom', name: 'Heirloom', note: 'Cream cards, gold filigree, green baize' },
  { id: 'darbar', name: 'Darbar', note: 'Vintage Indian court deck, peacock felt' },
  { id: 'pop', name: 'Pop', note: 'Bold white cards, bright chips, cobalt felt' },
];

const KEY = 'ph_theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const valid = (id) => THEMES.some((t) => t.id === id);

export function applyTheme(id = read()) {
  const theme = valid(id) ? id : THEMES[0].id;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ({ pop: '#e9ede6', darbar: '#17142a' })[theme] ?? '#14110e');
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || applyTheme());
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, setTheme];
}
