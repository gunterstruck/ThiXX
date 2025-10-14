// =================================================================================
// WHITE LABELING KONFIGURATION
// =================================================================================
// In dieser Datei können Sie verschiedene Marken (Labels) für die App definieren.
// =================================================================================

const AppConfig = {
  // Wir setzen das ursprüngliche HTML-Logo als Standard.
  defaultBrand: 'thixx-html',

  brands: [
    {
      // Dies ist die ursprüngliche ThiXX-Marke mit dem gestylten HTML-Logo.
      id: 'thixx-html',
      name: 'ThiXX (HTML)',
      short_name: 'ThiXX',
      theme_color: '#f04e37',
      logo: {
        type: 'html', 
        value: `
          <h1 class="logo">
            <span class="logo-orange">T</span>
            <span class="logo-orange">H</span>
            <span class="i-letter"><span class="i-dot"></span></span>
            <span class="logo-gray">XX</span>
          </h1>
        `
      },
      icons: {
        // Hier werden die ursprünglichen, ersten Icons verwendet.
        '192': '/ThiXX/assets/THiXX_Icon_192x192.png',
        '512': '/ThiXX/assets/THiXX_Icon_512x512.png'
      }
    },
    {
      // NEU: Konfiguration für die Marke ThiXX mit einem PNG-Bild als Logo.
      id: 'thixx-png',
      name: 'ThiXX (PNG)',
      short_name: 'ThiXX',
      theme_color: '#f04e37', 
      
      // Das Logo ist hier ein einfacher Verweis auf eine Bilddatei.
      logo: {
        type: 'image', 
        // KORRIGIERT: Der Pfad verweist jetzt wie gewünscht auf eine .png-Datei.
        value: '/ThiXX/assets/THiXX_Icon_512x512.png'
      },
      
      // Hier werden die neuen App-Icons verwendet, die Sie hochgeladen haben.
      icons: {
        // KORRIGIERT: Die Pfade verweisen jetzt wie gewünscht auf die .png-Dateien.
        '192': '/ThiXX/assets/icon-192.png',
        '512': '/ThiXX/assets/icon-512.png'
      }
    }
  ]
};

