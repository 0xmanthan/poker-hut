// Each theme restyles the whole room: felt, rail, cards, card backs and chips.
// All of it is CSS (see [data-theme] blocks in styles.css); this only picks one.
// At a table the host's choice applies to everyone; the lobby keeps the last one seen.
export const THEMES = [
  { id: 'heirloom', name: 'Heirloom', note: 'Cream cards, gold filigree, green baize' },
  { id: 'darbar', name: 'Darbar', note: 'Vintage Indian court deck, peacock felt' },
  { id: 'midnight', name: 'Midnight', note: 'Navy felt, black rail, red line, cup holders' },
  { id: 'claude', name: 'Claude', note: 'Ivory room, clay felt, slate rail' },
];

const KEY = 'ph_theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const valid = (id) => THEMES.some((t) => t.id === id);
const BAR = { midnight: '#0c0d10', darbar: '#17142a', claude: '#f0eee6' };

export function applyTheme(id = read()) {
  const theme = valid(id) ? id : THEMES[0].id;
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme] ?? '#14110e');
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  return theme;
}
