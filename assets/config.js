// =================================================================================
// WHITE LABELING KONFIGURATION (FINALE VERSION)
// =================================================================================
const AppConfig = {
  // Wir setzen das HTML-Logo als Standard.
  defaultBrand: 'thixx-html',

  brands: [
    {
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
        // Pfade exakt an hochgeladene Dateien angepasst
        '192': '/ThiXX/assets/THiXX_Icon_192x192.png',
        '512': '/ThiXX/assets/THiXX_Icon_512x512.jpg' // Korrekter Dateityp .jpg
      }
    },
    {
      id: 'thixx-png',
      name: 'ThiXX (PNG)',
      short_name: 'ThiXX',
      theme_color: '#f04e37',
      logo: {
        type: 'image', 
        value: '/ThiXX/assets/THiXX_Icon_512x512.jpg' // Korrekter Dateityp .jpg
      },
      icons: {
        // Pfade exakt an hochgeladene Dateien angepasst
        '192': '/ThiXX/assets/icon-192.png',
        '512': '/ThiXX/assets/icon-512.png'
      }
    },
    {
        // Diese Marke wird für den Theme-Button verwendet
        id: 'customer-brand',
        icons: {
            '192': '/ThiXX/assets/icon-192.png'
        }
    }
  ]
};

