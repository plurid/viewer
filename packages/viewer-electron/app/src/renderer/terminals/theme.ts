/** xterm colours for each Viewer look; one source for new and restyled terminals. */
export function terminalTheme(look: 'dark' | 'light') {
  return look === 'dark'
    ? { background: '#25282e', foreground: '#eeeeef', cursor: '#9abfd1' }
    : { background: '#f5f6f8', foreground: '#25282e', cursor: '#40748d' };
}
