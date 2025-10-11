document.addEventListener('DOMContentLoaded', () => {
    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/ThiXX/sw.js', { scope: '/ThiXX/' })
                .then(reg => console.log('Service Worker registered successfully with scope:', reg.scope))
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }

    // --- DOM Element References ---
    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const writeNfcBtn = document.getElementById('write-nfc-btn');
    const copyToFormBtn = document.getElementById('copy-to-form-btn');
    const saveJsonBtn = document.getElementById('save-json-btn');
    const loadJsonInput = document.getElementById('load-json-input');
    const nfcStatusBadge = document.getElementById('nfc-status-badge');
    const nfcFallback = document.getElementById('nfc-fallback');
    const messageBanner = document.getElementById('message-banner');
    const form = document.getElementById('nfc-write-form');
    const payloadOutput = document.getElementById('payload-output');
    const payloadSize = document.getElementById('payload-size');
    const payloadContainer = document.getElementById('payload-container');
    const readResultContainer = document.getElementById('read-result');
    const protocolCard = document.getElementById('protocol-card');
    const rawDataOutput = document.getElementById('raw-data-output');
    const autoWriteToggle = document.getElementById('auto-write-toggle');
    const autoWriteHint = document.getElementById('auto-write-hint');

    // --- Constants and State ---
    const MAX_PAYLOAD_BYTES = 880;
    const READ_COOLDOWN_MS = 1500;
    let scannedDataObject = null;
    let isReading = false;
    let readCooldown = false;
    let currentScanAbort = null;
    let isWriting = false;
    let writeCooldown = false;
    let autoWriteArmed = false;
    let autoScanArmedOnce = false;

    const fieldMap = {
        'HK.Nr.': 'HK', 'KKS': 'KKS', 'Leistung': 'P', 'Strom': 'I', 'Spannung': 'U', 'Widerstand': 'R',
        'Regler': 'Reg', 'Sicherheitsregler/Begrenzer': 'Sich', 'Wächter': 'Wäch', 'Projekt Nr.': 'Proj',
        'Anzahl Heizkabeleinheiten': 'Anz', 'Trennkasten': 'TB', 'Heizkabeltyp': 'HKT', 'Schaltung': 'Sch',
        'PT 100': 'PT100', 'NiCr-Ni': 'NiCr', 'geprüft von': 'Chk', 'am': 'Date'
    };
    const reverseFieldMap = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]));

    // --- Initialization ---
    init();

    function init() {
        setupEventListeners();
        setupTheme();
        setTodaysDate();
        checkNfcSupport();
        initCollapsibles(); // Initialize collapsible sections

        // Variante A: Wenn der Lesen-Tab aktiv ist, Scan sofort (oder beim ersten Tap) starten
        const readTabActive = document
            .querySelector('.tab-link[data-tab="read-tab"]')
            ?.classList.contains('active');

        if (readTabActive && 'NDEFReader' in window) {
            armImmediateScan();
        }
    }

    // --- Collapsible Bereiche aktivieren ---
    function initCollapsibles() {
        // 1️⃣ Gesamten "gelesenen" Container einklappbar machen
        const readResultEl = document.getElementById('read-result');
        if (readResultEl) {
            makeCollapsible(readResultEl);
            readResultEl.classList.remove('expanded'); // Start: eingeklappt
        }

        // 2️⃣ Schreiben-Tab komplett einklappbar machen
        const writeTab = document.getElementById('write-tab');
        const wrapperId = 'write-collapsible';
        let wrapper = document.getElementById(wrapperId);

        if (writeTab && !wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = wrapperId;
            wrapper.classList.add('collapsible'); // <<< Wichtig: direkt collapsible
            // Bestehende Inhalte verschieben
            while (writeTab.firstChild) {
                wrapper.appendChild(writeTab.firstChild);
            }
            writeTab.appendChild(wrapper);
        }

        if (wrapper) {
            makeCollapsible(wrapper);
            wrapper.classList.remove('expanded'); // Start: eingeklappt
        }
    }


    function checkNfcSupport() {
        if ('NDEFReader' in window) {
            setNfcBadge('available');
        } else {
            setNfcBadge('unsupported');
            nfcFallback.classList.remove('hidden');
            writeNfcBtn.disabled = true;
        }
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        writeNfcBtn.addEventListener('click', writeNfcTag);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonInput.addEventListener('change', loadJsonIntoForm);

        autoWriteToggle.addEventListener('click', () => {
            armAutoWrite(!autoWriteArmed);
        });

        form.addEventListener('input', updatePayloadOnChange);
        form.addEventListener('change', updatePayloadOnChange);

        document.getElementById('has_PT100').addEventListener('change', (e) => {
            document.getElementById('PT 100').disabled = !e.target.checked;
        });
        document.getElementById('has_NiCr-Ni').addEventListener('change', (e) => {
            document.getElementById('NiCr-Ni').disabled = !e.target.checked;
        });
    }

    // --- Theme Switcher Logic ---
    function setupTheme() {
        const themeButtons = document.querySelectorAll('.theme-btn');
        const THEME_KEY = 'thixx-theme';

        function applyTheme(themeName) {
            document.body.setAttribute('data-theme', themeName);
            localStorage.setItem(THEME_KEY, themeName);

            themeButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.theme === themeName);
            });
            
            const metaThemeColor = document.querySelector('meta[name="theme-color"]');
            if (metaThemeColor) {
                let color;
                if (themeName === 'dark') color = '#0f172a';
                else if (themeName === 'thixx') color = '#f8f9fa';
                else if (themeName === 'customer-brand') color = '#f8f9fa';
                metaThemeColor.setAttribute('content', color);
            }
        }

        themeButtons.forEach(button => {
            button.addEventListener('click', () => {
                applyTheme(button.dataset.theme);
            });
        });

        const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
        applyTheme(savedTheme);
    }

    // --- UI Functions ---
    function switchTab(tabId) {
        if (currentScanAbort) {
            currentScanAbort.abort();
            cleanupAfterRead(false);
        }

        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
        
        if (tabId === 'read-tab') {
            if (autoWriteArmed) armAutoWrite(false);
            // Variante B: Immer automatisch neu scannen, sobald man in den Lesen-Tab wechselt
            armImmediateScan();
        } else if (tabId === 'write-tab') {
            payloadContainer.classList.remove('hidden');
            generateAndShowPayload();
            autoWriteHint.textContent = 'Tipp: „Auto-Schreiben aktivieren“ starten und den Tag einfach an das Gerät halten.';
        }
    }

    function showMessage(text, type = 'info', duration = 4000) {
        messageBanner.textContent = text;
        messageBanner.className = 'message-banner';
        messageBanner.classList.add(type);
        messageBanner.classList.remove('hidden');
        setTimeout(() => messageBanner.classList.add('hidden'), duration);
    }

    function setTodaysDate() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('am').value = `${yyyy}-${mm}-${dd}`;
    }

    function setNfcBadge(state) {
        nfcStatusBadge.classList.remove('hidden', 'ok', 'err', 'info');
        switch (state) {
            case 'unsupported':
                nfcStatusBadge.textContent = 'NFC nicht unterstützt';
                nfcStatusBadge.classList.add('err');
                break;
            case 'available':
                nfcStatusBadge.textContent = 'NFC verfügbar';
                nfcStatusBadge.classList.add('info');
                break;
            case 'on':
                nfcStatusBadge.textContent = 'NFC aktiv';
                nfcStatusBadge.classList.add('ok');
                break;
            case 'off':
                nfcStatusBadge.textContent = 'NFC aus / Keine Berechtigung';
                nfcStatusBadge.classList.add('err');
                break;
            case 'scanning':
                nfcStatusBadge.textContent = 'Scannen...';
                nfcStatusBadge.classList.add('info');
                break;
        }
    }

    // --- NFC Read Logic ---
    function startReadCooldown() {
        readCooldown = true;
        setTimeout(() => { readCooldown = false; }, READ_COOLDOWN_MS);
    }

    function cleanupAfterRead(success) {
        isReading = false;
        startReadCooldown();
        currentScanAbort = null;
    }

    async function readNfcTag() {
        if (!('NDEFReader' in window)) return;
        if (isReading || readCooldown) return;

        isReading = true;
        setNfcBadge('scanning');
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info');

        const ndef = new NDEFReader();
        currentScanAbort = ('AbortController' in window) ? new AbortController() : null;

        try {
            await ndef.scan(currentScanAbort ? { signal: currentScanAbort.signal } : {});

            ndef.onreadingerror = () => {
                setNfcBadge('available');
                showMessage('Fehler beim Lesen des NFC-Tags.', 'err');
                cleanupAfterRead(false);
            };

            ndef.onreading = (event) => {
                setNfcBadge('on');
                const firstRecord = event.message.records[0];
                if (firstRecord && firstRecord.recordType === 'text') {
                    const textDecoder = new TextDecoder(firstRecord.encoding);
                    const text = textDecoder.decode(firstRecord.data);
                    processNfcData(text);
                    showMessage('NFC-Tag erfolgreich gelesen!', 'ok');
                } else {
                    showMessage('Kein Text-Record auf dem Tag gefunden.', 'err');
                }
                if (currentScanAbort) currentScanAbort.abort();
                cleanupAfterRead(true);
            };
        } catch (error) {
            setNfcBadge('off');
            showMessage(`Scan-Fehler: ${error.message}`, 'err');
            cleanupAfterRead(false);
        }
    }

    function processNfcData(text) {
        rawDataOutput.value = text;
        try {
            scannedDataObject = parseNfcText(text);
            displayParsedData(scannedDataObject);
            readResultContainer.classList.remove('hidden');
        } catch(e) {
            showMessage(`Fehler beim Verarbeiten der Daten: ${e.message}`, 'err');
            readResultContainer.classList.add('hidden');
            scannedDataObject = null;
        }
    }

    function parseNfcText(text) {
        const data = {};
        text = text.trim();
        if (text.startsWith('v1')) {
            const content = text.substring(2).trim();
            const regex = /(\w+):([^\n]*)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const key = reverseFieldMap[match[1]] || match[1];
                data[key] = match[2].trim();
            }
            return data;
        }
        if (Object.keys(data).length === 0) throw new Error("Kein bekanntes Format erkannt.");
        return data;
    }

    function displayParsedData(data) {
        protocolCard.innerHTML = `
            <div class="card-main">
                ${createDataPair('HK.Nr.', data['HK.Nr.'])}
                ${createDataPair('KKS', data['KKS'])}
            </div>
            <div class="card-section">
                ${createDataPair('Leistung', data['Leistung'], 'kW')}
                ${createDataPair('Strom', data['Strom'], 'A')}
                ${createDataPair('Spannung', data['Spannung'], 'V')}
                ${createDataPair('Widerstand', data['Widerstand'], 'Ω')}
            </div>
            <div class="card-section">
                ${createDataPair('Anzahl Heizkabeleinheiten', data['Anzahl Heizkabeleinheiten'], 'Stk')}
                ${createDataPair('Trennkasten', data['Trennkasten'], 'Stk')}
                ${createDataPair('Heizkabeltyp', data['Heizkabeltyp'])}
                ${createDataPair('Schaltung', data['Schaltung'])}
                ${createDataPair('PT 100', data['PT 100'], 'Stk')}
                ${createDataPair('NiCr-Ni', data['NiCr-Ni'], 'Stk')}
            </div>
            <div class="card-section">
                 ${createDataPair('Regler', data['Regler'], '°C')}
                 ${createDataPair('Sicherheitsregler/Begrenzer', data['Sicherheitsregler/Begrenzer'], '°C')}
                 ${createDataPair('Wächter', data['Wächter'], '°C')}
            </div>
            <div class="card-footer">
                ${createDataPair('Projekt Nr.', data['Projekt Nr.'])}
                ${createDataPair('geprüft von', data['geprüft von'])}
                ${createDataPair('am', data['am'])}
            </div>
        `;
        
        // Nach dem Anzeigen neuer Daten den gesamten Container wieder einklappen
        readResultContainer.classList.add('collapsible');
        readResultContainer.classList.remove('expanded');
    }

    function createDataPair(label, value, unit = '') {
        if (!value) return '';
        return `
            <div class="data-pair">
                <span class="data-pair-label">${label}</span>
                <span class="data-pair-value">${value} ${unit}</span>
            </div>
        `;
    }

    // --- NFC Write Logic ---
    function updatePayloadOnChange() {
        if (!payloadContainer.classList.contains('hidden')) {
            generateAndShowPayload();
        }
    }

    function generateAndShowPayload() {
        const formData = getFormData();
        const payload = formatToCompact(formData);
        payloadOutput.value = payload;

        const byteCount = new TextEncoder().encode(payload).length;
        payloadSize.textContent = `${byteCount} / ${MAX_PAYLOAD_BYTES} Bytes`;
        
        if (byteCount > MAX_PAYLOAD_BYTES) {
            payloadSize.classList.add('limit-exceeded');
            writeNfcBtn.disabled = true;
            showMessage('Payload zu groß! Schreiben deaktiviert.', 'err');
        } else {
            payloadSize.classList.remove('limit-exceeded');
            writeNfcBtn.disabled = false;
        }
    }

    function getFormData() {
        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            if (value.trim()) {
                data[key] = value.trim();
            }
        }
        if(!document.getElementById('has_PT100').checked) delete data['PT 100'];
        if(!document.getElementById('has_NiCr-Ni').checked) delete data['NiCr-Ni'];
        delete data['has_PT100'];
        delete data['has_NiCr-Ni'];
        return data;
    }

    function formatToCompact(data) {
        let compactString = 'v1';
        const parts = [];
        
        for (const [key, shortKey] of Object.entries(fieldMap)) {
            if (data[key]) {
                parts.push(`${shortKey}:${data[key]}`);
            }
        }

        if (parts.length > 0) {
            compactString += '\n' + parts.join('\n');
        }
        
        return compactString;
    }
    
    function startWriteCooldown() {
        writeCooldown = true;
        setTimeout(() => { writeCooldown = false; }, READ_COOLDOWN_MS);
    }

    async function writeNfcTag() {
        if (!('NDEFReader' in window)) return;
        if (isWriting || writeCooldown) return;
        
        isWriting = true;
        generateAndShowPayload();
        const payload = payloadOutput.value;
        if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) {
             showMessage('Payload ist zu groß zum Schreiben!', 'err');
             isWriting = false;
             return;
        }
        
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info');
        writeNfcBtn.disabled = true;

        try {
            const ndef = new NDEFReader();
            await ndef.write(payload);
            showMessage('Daten erfolgreich auf NFC-Tag geschrieben!', 'ok');
        } catch (error) {
            showMessage(`Schreibfehler: ${error.message}`, 'err');
        } finally {
            isWriting = false;
            startWriteCooldown();
            writeNfcBtn.disabled = false;
            generateAndShowPayload();
        }
    }

    // --- Auto Write Logic ---
    function armAutoWrite(armed) {
        autoWriteArmed = armed;
        if (autoWriteArmed) {
            autoWriteToggle.textContent = 'Auto-Schreiben stoppen';
            autoWriteHint.textContent = 'Bereit zum Schreiben – halten Sie den Tag an das Gerät. Änderungen im Formular werden übernommen.';
            autoWriteOnce();
        } else {
            autoWriteToggle.textContent = 'Auto-Schreiben aktivieren';
            autoWriteHint.textContent = '';
        }
    }

    async function autoWriteOnce() {
        if (!autoWriteArmed || writeCooldown) return;

        try {
            generateAndShowPayload();
            const payload = payloadOutput.value;
            const ndef = new NDEFReader();
            await ndef.write(payload);
            showMessage('Daten geschrieben. Sie können den nächsten Tag anhalten …', 'ok');
            startWriteCooldown();
        } catch (err) {
            showMessage(`Schreibfehler: ${err.message}`, 'err');
            startWriteCooldown();
        } finally {
            if (autoWriteArmed) {
                setTimeout(autoWriteOnce, 600);
            }
        }
    }

    // Startet den Scan direkt oder beim ersten Tap (wenn Browser es verlangt)
    function armImmediateScan() {
        // Versuch sofort zu starten
        setTimeout(() => {
            readNfcTag();
        }, 150);

        // Fallback: Falls User-Gesture nötig ist, wird dieser nur einmalig registriert.
        if (autoScanArmedOnce) return;
        autoScanArmedOnce = true;

        const startOnGesture = () => {
            readNfcTag();
            window.removeEventListener('pointerdown', startOnGesture, { capture: true });
            window.removeEventListener('keydown', startOnGesture, { capture: true });
        };
        window.addEventListener('pointerdown', startOnGesture, { once: true, capture: true });
        window.addEventListener('keydown', startOnGesture, { once: true, capture: true });
    }

    // --- Collapsible helpers ---
    function makeCollapsible(el) {
      if (!el) return;
       // Verhindern, dass die Logik mehrfach auf dasselbe Element angewendet wird
      if (el.dataset.collapsibleApplied) return;
      el.dataset.collapsibleApplied = 'true';

      el.classList.add('collapsible');

      // Hinweis-Badge einfügen (nur im eingeklappten Zustand sichtbar)
      let hint = el.querySelector('.collapsible-hint');
      if (!hint) {
          hint = document.createElement('div');
          hint.className = 'collapsible-hint';
          hint.textContent = 'Tippen zum Öffnen';
          el.appendChild(hint);
      }


      // Toggle-Handler: bei Tap/Enter/Space aufklappen
      const toggle = () => {
        // Wenn bereits expanded → NICHT wieder zuklappen
        if (el.classList.contains('expanded')) return;
        el.classList.add('expanded');
      };

      // Click nur zum Öffnen
      el.addEventListener('click', (e) => {
        // Klicks auf Eingabeelemente sollen nichts umschalten
        const tag = (e.target.tagName || '').toLowerCase();
        if (['input','select','textarea','button','label','summary','details'].includes(tag)) return;
        toggle();
      });

      // Tastaturzugänglichkeit
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-expanded', 'false');
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
          el.setAttribute('aria-expanded', el.classList.contains('expanded') ? 'true' : 'false');
        }
      });

      // Wenn per Script aufgeklappt wird, aria aktualisieren
      const observer = new MutationObserver(() => {
        el.setAttribute('aria-expanded', el.classList.contains('expanded') ? 'true' : 'false');
      });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    // --- Form & Data Handling ---
    function populateFormFromScan() {
        if (!scannedDataObject) {
            showMessage('Keine Daten zum Übernehmen vorhanden.', 'err');
            return;
        }
        form.reset();
        setTodaysDate();

        for (const [key, value] of Object.entries(scannedDataObject)) {
            const input = form.elements[key];
            if (input) {
                if (input.type === 'radio') {
                    const radioGroup = form.querySelectorAll(`input[name="${key}"]`);
                    radioGroup.forEach(radio => {
                        if (radio.value === value) {
                            radio.checked = true;
                        }
                    });
                } else if (input.type === 'checkbox') {
                    input.checked = (value === 'true' || value === 'on');
                } else {
                    input.value = value;
                }
            }
        }
        
        const pt100Input = document.getElementById('PT 100');
        const hasPt100Checkbox = document.getElementById('has_PT100');
        if (scannedDataObject['PT 100']) {
            pt100Input.value = scannedDataObject['PT 100'];
            pt100Input.disabled = false;
            hasPt100Checkbox.checked = true;
        } else {
            pt100Input.disabled = true;
            hasPt100Checkbox.checked = false;
        }

        const niCrInput = document.getElementById('NiCr-Ni');
        const hasNiCrCheckbox = document.getElementById('has_NiCr-Ni');
        if (scannedDataObject['NiCr-Ni']) {
            niCrInput.value = scannedDataObject['NiCr-Ni'];
            niCrInput.disabled = false;
            hasNiCrCheckbox.checked = true;
        } else {
             niCrInput.disabled = true;
            hasNiCrCheckbox.checked = false;
        }

        switchTab('write-tab');
        showMessage('Daten in Formular übernommen.', 'ok');
    }

    function saveFormAsJson() {
        const data = getFormData();
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = data['HK.Nr.'] || data['KKS'] || `thixx-export-${Date.now()}`;
        a.download = `${fileName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('Daten als JSON gespeichert.', 'ok');
    }

    function loadJsonIntoForm(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                scannedDataObject = data;
                populateFormFromScan();
                showMessage('JSON-Datei erfolgreich geladen.', 'ok');
            } catch (error) {
                showMessage(`Fehler beim Laden der JSON-Datei: ${error.message}`, 'err');
            } finally {
                event.target.value = null;
            }
        };
        reader.readAsText(file);
    }
});

