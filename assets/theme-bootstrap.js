/**
 * ROBUSTHEITS-UPDATE (Theme-Flickern):
 * Dieses Skript wird vor dem Rest der Seite geladen, um das Theme aus dem
 * localStorage zu lesen und sofort auf das <html>-Element anzuwenden.
 * Dies verhindert ein "Aufblitzen" des Standard-Themes (FOUC - Flash of Unstyled Content),
 * bevor das Haupt-JavaScript die Kontrolle übernimmt.
 * Es wurde ausgelagert, um die Content Security Policy (CSP) zu erfüllen.
 */
(function() {
  try {
    const theme = localStorage.getItem('thixx-theme') || 'customer-brand';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    console.error('Failed to set theme from localStorage', e);
    // Fallback auf ein Standard-Theme, falls localStorage blockiert ist.
    document.documentElement.setAttribute('data-theme', 'customer-brand');
  }
})();

