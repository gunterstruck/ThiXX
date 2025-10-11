document.addEventListener('DOMContentLoaded', () => {
    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/ThiXX/sw.js', { scope: '/ThiXX/' })
                .then(reg => console.log('Service Worker registered:', reg.scope))
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

    // --- Constants ---
    const MAX_PAYLOAD_BYTES = 880;
    const READ_COOLDOWN_MS = 1500;
    const WRITE_COOLDOWN_MS = 2000;
    const SCAN_TIMEOUT_MS = 30000;
    const DEBUG_MODE = true; // Für detaillierte Fehlerausgaben

    let scannedDataObject = null;
    let autoWriteArmed = false;
    let autoScanArmedOnce = false;

    // --- Enhanced NFC Manager mit Write-Validierung ---
    const nfcManager = {
        reader: null,
        abortController: null,
        isReading: false,
        isWriting: false,
        readCooldown: false,
        writeCooldown: false,
        readTimeout: null,
        lastError: null,

        initializeReader: function() {
            if (!this.reader && 'NDEFReader' in window) {
                this.reader = new NDEFReader();
            }
            return this.reader;
        },

        abort: function() {
            if (this.abortController) {
                try {
                    this.abortController.abort();
                } catch(e) {
                    console.warn('Abort failed:', e);
                }
                this.abortController = null;
            }
            if (this.readTimeout) {
                clearTimeout(this.readTimeout);
                this.readTimeout = null;
            }
            this.isReading = false;
        },

        logError: function(context, error) {
            this.lastError = { context, error, timestamp: Date.now() };
            console.error(`[NFC ${context}]`, error);
            if (DEBUG_MODE) {
                console.log('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
            }
        }
    };

    const fieldMap = {
        'HK.Nr.': 'HK', 'KKS': 'KKS', 'Leistung': 'P', 'Strom': 'I', 'Spannung': 'U', 
        'Widerstand': 'R', 'Regler': 'Reg', 'Sicherheitsregler/Begrenzer': 'Sich', 
        'Wächter': 'Wäch', 'Projekt Nr.': 'Proj', 'Anzahl Heizkabeleinheiten': 'Anz', 
        'Trennkasten': 'TB', 'Heizkabeltyp': 'HKT', 'Schaltung': 'Sch',
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
        initCollapsibles();

        const readTabActive = document.querySelector('.tab-link[data-tab="read-tab"]')?.classList.contains('active');
        if (readTabActive && 'NDEFReader' in window) {
            armImmediateScan();
        }
    }

    function initCollapsibles() {
        document.querySelectorAll('.collapsible').forEach(el => {
            makeCollapsible(el);
            el.classList.remove('expanded');
        });
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

    // --- Event Listeners ---
    function setupEventListeners() {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        writeNfcBtn.addEventListener('click', writeNfcTag);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonInput.addEventListener('change', loadJsonIntoForm);
        autoWriteToggle.addEventListener('click', () => armAutoWrite(!autoWriteArmed));

        form.addEventListener('input', updatePayloadOnChange);
        form.addEventListener('change', updatePayloadOnChange);

        document.getElementById('has_PT100').addEventListener('change', (e) => {
            document.getElementById('PT 100').disabled = !e.target.checked;
        });
        document.getElementById('has_NiCr-Ni').addEventListener('change', (e) => {
            document.getElementById('NiCr-Ni').disabled = !e.target.checked;
        });
    }

    // --- Theme Switcher ---
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
                const colors = { dark: '#0f172a', thixx: '#f8f9fa', 'customer-brand': '#f8f9fa' };
                metaThemeColor.setAttribute('content', colors[themeName] || '#0f172a');
            }
        }

        themeButtons.forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));
        applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    }

    // --- UI Functions ---
    function switchTab(tabId) {
        nfcManager.abort();
        if (autoWriteArmed) armAutoWrite(false);

        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
        
        if (tabId === 'read-tab') {
            armImmediateScan();
        } else if (tabId === 'write-tab') {
            payloadContainer.classList.remove('hidden');
            generateAndShowPayload();
            autoWriteHint.textContent = 'Tipp: "Auto-Schreiben aktivieren" starten und den Tag einfach an das Gerät halten.';
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
        const states = {
            unsupported: ['NFC nicht unterstützt', 'err'],
            available: ['NFC verfügbar', 'info'],
            on: ['NFC aktiv', 'ok'],
            off: ['NFC aus / Keine Berechtigung', 'err'],
            scanning: ['Scannen...', 'info']
        };
        if (states[state]) {
            nfcStatusBadge.textContent = states[state][0];
            nfcStatusBadge.classList.add(states[state][1]);
        }
    }

    // --- NFC Read Logic ---
    function startReadCooldown() {
        nfcManager.readCooldown = true;
        setTimeout(() => { nfcManager.readCooldown = false; }, READ_COOLDOWN_MS);
    }

    function cleanupAfterRead() {
        nfcManager.isReading = false;
        if (nfcManager.readTimeout) {
            clearTimeout(nfcManager.readTimeout);
            nfcManager.readTimeout = null;
        }
        startReadCooldown();
    }

    async function readNfcTag() {
        const ndef = nfcManager.initializeReader();
        if (!ndef || nfcManager.isReading || nfcManager.readCooldown) return;

        nfcManager.isReading = true;
        setNfcBadge('scanning');
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info');

        nfcManager.abort();
        nfcManager.abortController = new AbortController();

        try {
            nfcManager.readTimeout = setTimeout(() => {
                showMessage('Scan-Timeout: Kein Tag gefunden.', 'err');
                nfcManager.abort();
                cleanupAfterRead();
                setNfcBadge('available');
            }, SCAN_TIMEOUT_MS);

            await ndef.scan({ signal: nfcManager.abortController.signal });

            ndef.onreadingerror = () => {
                showMessage('Fehler beim Lesen des NFC-Tags.', 'err');
                nfcManager.abort();
                cleanupAfterRead();
                setNfcBadge('available');
            };

            ndef.onreading = (event) => {
                setNfcBadge('on');
                const firstRecord = event.message.records[0];
                if (firstRecord && firstRecord.recordType === 'text') {
                    const textDecoder = new TextDecoder(firstRecord.encoding || 'utf-8');
                    const text = textDecoder.decode(firstRecord.data);
                    processNfcData(text);
                    showMessage('NFC-Tag erfolgreich gelesen!', 'ok');
                } else {
                    showMessage('Kein Text-Record auf dem Tag gefunden.', 'err');
                }
                nfcManager.abort();
                cleanupAfterRead();
            };
        } catch (error) {
            if (error.name !== 'AbortError') {
                nfcManager.logError('Read', error);
                showMessage(`Scan-Fehler: ${getReadableError(error)}`, 'err');
            }
            cleanupAfterRead();
            setNfcBadge('off');
        }
    }

    function processNfcData(text) {
        rawDataOutput.value = text;
        try {
            scannedDataObject = parseNfcText(text);
            displayParsedData(scannedDataObject);
            readResultContainer.classList.remove('hidden');
        } catch(e) {
            showMessage(`Fehler beim Verarbeiten: ${e.message}`, 'err');
            readResultContainer.classList.add('hidden');
            scannedDataObject = null;
        }
    }

    function parseNfcText(text) {
        const data = {};
        text = text.trim();
        if (text.startsWith('v1')) {
            const content = text.substring(2).trim();
            const regex = /([^:\n]+):([^\n]*)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const key = reverseFieldMap[match[1].trim()] || match[1].trim();
                data[key] = match[2].trim();
            }
            if (Object.keys(data).length === 0) {
                throw new Error("v1-Format erkannt, aber keine Daten gefunden.");
            }
            return data;
        }
        throw new Error("Kein bekanntes Format erkannt.");
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

    // --- NFC Write Logic (FIXED) ---
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
        } else {
            payloadSize.classList.remove('limit-exceeded');
            writeNfcBtn.disabled = false;
        }
    }

    function getFormData() {
        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            if (value.trim()) data[key] = value.trim();
        }
        if (!document.getElementById('has_PT100').checked) delete data['PT 100'];
        if (!document.getElementById('has_NiCr-Ni').checked) delete data['NiCr-Ni'];
        delete data['has_PT100'];
        delete data['has_NiCr-Ni'];
        return data;
    }

    function formatToCompact(data) {
        let compactString = 'v1';
        const parts = [];
        
        for (const [key, shortKey] of Object.entries(fieldMap)) {
            if (data[key]) parts.push(`${shortKey}:${data[key]}`);
        }

        if (parts.length > 0) compactString += '\n' + parts.join('\n');
        return compactString;
    }
    
    function startWriteCooldown() {
        nfcManager.writeCooldown = true;
        setTimeout(() => { nfcManager.writeCooldown = false; }, WRITE_COOLDOWN_MS);
    }

    function getReadableError(error) {
        const errorMap = {
            'NotAllowedError': 'Zugriff verweigert. Bitte NFC-Berechtigung erteilen.',
            'NotSupportedError': 'NFC wird nicht unterstützt.',
            'NotReadableError': 'Tag konnte nicht gelesen werden.',
            'NetworkError': 'Netzwerkfehler beim NFC-Zugriff.',
            'InvalidStateError': 'Ungültiger Zustand. Bitte App neu laden.',
            'DataError': 'Daten konnten nicht verarbeitet werden.',
            'AbortError': 'Vorgang abgebrochen.'
        };
        return errorMap[error.name] || error.message || 'Unbekannter Fehler';
    }

    // KORRIGIERTE WRITE-FUNKTION
    async function writeNfcTag() {
        const ndef = nfcManager.initializeReader();
        if (!ndef || nfcManager.isWriting || nfcManager.writeCooldown) return;
        
        nfcManager.isWriting = true;
        generateAndShowPayload();
        const payload = payloadOutput.value;
        
        const byteCount = new TextEncoder().encode(payload).length;
        if (byteCount > MAX_PAYLOAD_BYTES) {
            showMessage('Payload zu groß zum Schreiben!', 'err');
            nfcManager.isWriting = false;
            return;
        }
        
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info', 6000);
        writeNfcBtn.disabled = true;

        try {
            // KRITISCH: Korrektes Write-Format für Web NFC API
            await ndef.write(payload); // String wird automatisch als text/plain behandelt
            
            showMessage('✓ Daten erfolgreich geschrieben!', 'ok', 3000);
            if (DEBUG_MODE) console.log('Write successful. Payload:', payload);
            
        } catch (error) {
            nfcManager.logError('Write', error);
            const readableError = getReadableError(error);
            showMessage(`✗ Schreibfehler: ${readableError}`, 'err', 5000);
            
            if (DEBUG_MODE) {
                console.log('Payload that failed:', payload);
                console.log('Payload size:', byteCount, 'bytes');
            }
        } finally {
            nfcManager.isWriting = false;
            startWriteCooldown();
            writeNfcBtn.disabled = false;
        }
    }

    // --- Auto Write Logic (FIXED) ---
    function armAutoWrite(armed) {
        autoWriteArmed = armed;
        if (autoWriteArmed) {
            autoWriteToggle.textContent = 'Auto-Schreiben stoppen';
            autoWriteHint.textContent = 'Bereit – halten Sie Tags nacheinander an das Gerät.';
            autoWriteOnce();
        } else {
            autoWriteToggle.textContent = 'Auto-Schreiben aktivieren';
            autoWriteHint.textContent = '';
        }
    }

    async function autoWriteOnce() {
        if (!autoWriteArmed) return;
        
        const ndef = nfcManager.initializeReader();
        if (!ndef || nfcManager.isWriting || nfcManager.writeCooldown) {
            if (autoWriteArmed) setTimeout(autoWriteOnce, 600);
            return;
        }

        nfcManager.isWriting = true;
        try {
            generateAndShowPayload();
            const payload = payloadOutput.value;
            
            await ndef.write(payload);
            
            showMessage('✓ Tag geschrieben. Nächsten Tag anhalten...', 'ok', 2000);
            startWriteCooldown();
        } catch (err) {
            if (err.name !== 'AbortError') {
                nfcManager.logError('AutoWrite', err);
                showMessage(`✗ ${getReadableError(err)}`, 'err', 3000);
                startWriteCooldown();
            }
        } finally {
            nfcManager.isWriting = false;
            if (autoWriteArmed) setTimeout(autoWriteOnce, 600);
        }
    }

    // --- Scan Initiators ---
    function armImmediateScan() {
        setTimeout(readNfcTag, 150);

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
        if (!el || el.dataset.collapsibleApplied) return;
        el.dataset.collapsibleApplied = 'true';

        const toggle = () => {
            if (el.classList.contains('expanded')) return;
            el.classList.add('expanded');
            setTimeout(() => el.blur(), 0);
        };

        const overlay = el.querySelector('.collapsible-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle();
            });
        }

        el.addEventListener('click', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (['input', 'select', 'textarea', 'button', 'label', 'summary', 'details'].includes(tag) || 
                e.target.closest('.collapsible-overlay')) return;
            toggle();
        });

        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-expanded', 'false');
        
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });

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
                    form.querySelectorAll(`input[name="${key}"]`).forEach(radio => {
                        if (radio.value === value) radio.checked = true;
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
        document.getElementById('write-form-container').classList.add('expanded');
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
                showMessage(`Fehler beim Laden: ${error.message}`, 'err');
            } finally {
                event.target.value = null;
            }
        };
        reader.readAsText(file);
    }
});