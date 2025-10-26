/**
 * THEME BOOTSTRAP (Optimierte Version)
 * -------------------------------------
 * Dieses Skript wird VOR dem Rendern geladen.
 * Es sorgt dafür, dass sofort das in config.json definierte Design aktiv ist
 * – kein Gelb/Blau-Flickern mehr durch LocalStorage-Überbleibsel.
 */
(function() {
  try {
    // --- 1️⃣ Alte lokale Themes entfernen (z. B. "peterpohl")
    localStorage.removeItem('thixx-theme');

    // --- 2️⃣ Standardwert (falls config.json nicht geladen werden kann)
    let theme = 'customer-brand';

    // --- 3️⃣ config.json direkt synchron laden
    const request = new XMLHttpRequest();
    request.open('GET', '/ThiXX/config.json', false); // synchron, da sehr klein
    request.send(null);

    if (request.status === 200) {
      try {
        const config = JSON.parse(request.responseText);
        if (config && config.design) {
          // --- Design-Mapping (wie in app.js)
          const designThemes = {
            'thixx_standard': 'customer-brand', // 🔴 FIX: Geändert von 'dark'
            'peterpohl': 'customer-brand',
            'sigx': 'customer-brand',
            'othimm': 'customer-brand'
          };
          theme = designThemes[config.design] || 'customer-brand';
        }
      } catch (jsonErr) {
        console.warn('Theme config parsing failed:', jsonErr);
      }
    } else {
      console.warn('Theme config could not be loaded, using fallback:', request.status);
    }

    // --- 4️⃣ Theme sofort auf das Root-Element anwenden
    document.documentElement.setAttribute('data-theme', theme);

  } catch (e) {
    console.error('Theme initialization failed:', e);
    document.documentElement.setAttribute('data-theme', 'customer-brand');
  }
})();
