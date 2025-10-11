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
    const readNfcBtn = document.getElementById('read-nfc-btn');
    const writeNfcBtn = document.getElementById('write-nfc-btn');
    // ... (rest of DOM references are the same)
    const showPayloadBtn = document.getElementById('show-payload-btn');
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


    // --- Constants and State ---
    const MAX_PAYLOAD_BYTES = 880;
    let scannedDataObject = null;
    const fieldMap = {
        'HK.Nr.': 'HK', 'KKS': 'KKS', 'Leistung': 'P', 'Strom': 'I', 'Spannung': 'U', 'Widerstand': 'R',
        'Regler': 'Reg', 'Sicherheitsregler/Begrenzer': 'Sich', 'Wächter': 'Wäch', 'Projekt Nr.': 'Proj',
        'Anzahl Heizkabeleinheiten': 'Anz', 'Trennkasten': 'TB', 'Heizkabeltyp': 'HKT', 'Schaltung': 'Sch',
        'PT 100': 'PT100', 'NiCr-Ni': 'NiCr', 'geprüft von': 'Chk', 'am': 'Date'
    };
    const reverseFieldMap = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]));

    // --- NFC operation lock & cooldown ---
    const OPERATION_COOLDOWN_MS = 1500;
    let isReading = false;
    let isWriting = false;
    let operationCooldown = false;
    let currentScanController = null;

    function startOperationCooldown() {
        operationCooldown = true;
        setTimeout(() => { operationCooldown = false; }, OPERATION_COOLDOWN_MS);
    }

    // --- Initialization ---
    init();
    
    // ... (rest of the functions like setNfcBadge, init, setupEventListeners, etc. are the same)
    // --- NFC Badge Logic ---
    function setNfcBadge(state) {
      nfcStatusBadge.classList.remove('hidden', 'ok', 'err', 'info');
      switch (state) {
        case 'unsupported':
          nfcStatusBadge.textContent = 'NFC nicht verfügbar';
          nfcStatusBadge.classList.add('err');
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
        default: // 'available'
          nfcStatusBadge.textContent = 'NFC verfügbar';
          nfcStatusBadge.classList.add('info');
      }
    }

    function init() {
        if ('NDEFReader' in window) {
            setNfcBadge('available');
        } else {
            setNfcBadge('unsupported');
            nfcFallback.classList.remove('hidden');
            readNfcBtn.disabled = true;
            writeNfcBtn.disabled = true;
        }

        setupEventListeners();
        setupTheme();
        setTodaysDate();
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        readNfcBtn.addEventListener('click', readNfcTag);
        writeNfcBtn.addEventListener('click', writeNfcTag);
        showPayloadBtn.addEventListener('click', generateAndShowPayload);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonInput.addEventListener('change', loadJsonIntoForm);

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
                metaThemeColor.setAttribute('content', themeName === 'dark' ? '#0f172a' : '#e45d45');
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
        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
    }

    function showMessage(text, type = 'info', duration = 4000) {
        messageBanner.textContent = text;
        messageBanner.className = 'message-banner'; // Reset classes
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

    function disableButtons(disabled = true) {
        readNfcBtn.disabled = disabled;
        showPayloadBtn.disabled = disabled;
    }

    // --- NFC Read Logic ---
    function cleanupAfterRead() {
        isReading = false;
        startOperationCooldown();
        disableButtons(false);
        currentScanController = null;
    }

    async function readNfcTag() {
        if (!('NDEFReader' in window)) return;

        if (isReading || operationCooldown) {
            showMessage('Bitte kurz warten...', 'info', 1500);
            return;
        }
        isReading = true;

        setNfcBadge('scanning');
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info', 10000);
        disableButtons(true);

        const ndef = new NDEFReader();
        if ('AbortController' in window) {
            currentScanController = new AbortController();
        }

        try {
            await ndef.scan(currentScanController ? { signal: currentScanController.signal } : undefined);
            
            ndef.onreadingerror = () => {
                setNfcBadge('available');
                showMessage('Fehler beim Lesen des NFC-Tags.', 'err');
                cleanupAfterRead();
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

                if (currentScanController) {
                    currentScanController.abort();
                }
                cleanupAfterRead();
            };

        } catch (error) {
            setNfcBadge('off');
            showMessage(`Scan-Fehler: ${error}`, 'err');
            cleanupAfterRead();
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
        
        // ... (rest of parsing logic is the same)
        if (text.includes('|') && text.includes('---')) {
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && !l.includes('---'));
            lines.forEach(line => {
                const parts = line.split('|').map(p => p.trim()).filter(Boolean);
                if (parts.length === 2) {
                    data[parts[0]] = parts[1];
                }
            });
            delete data['Merkmal'];
            return data;
        }

        const lines = text.split('\n');
        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join(':').trim();
                data[key] = value;
            }
        });

        if(Object.keys(data).length === 0) throw new Error("Kein bekanntes Format erkannt.");
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
    function cleanupAfterWrite() {
        isWriting = false;
        startOperationCooldown();
        disableButtons(false);
        generateAndShowPayload();
    }

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
        
        payloadContainer.classList.remove('hidden');
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

    async function writeNfcTag() {
        if (!('NDEFReader' in window)) return;

        if (isWriting || operationCooldown) {
            showMessage('Bitte kurz warten...', 'info', 1500);
            return;
        }
        isWriting = true;
        
        generateAndShowPayload();
        const payload = payloadOutput.value;
        if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) {
             showMessage('Payload ist zu groß zum Schreiben!', 'err');
             isWriting = false; // release lock
             return;
        }
        
        setNfcBadge('scanning');
        showMessage('Bitte NFC-Tag an das Gerät halten...', 'info', 10000);
        disableButtons(true);
        writeNfcBtn.disabled = true;

        try {
            const ndef = new NDEFReader();
            await ndef.write(payload);
            setNfcBadge('on');
            showMessage('Daten erfolgreich auf NFC-Tag geschrieben!', 'ok');
        } catch (error) {
            setNfcBadge('off');
            showMessage(`Schreibfehler: ${error}`, 'err');
        } finally {
            cleanupAfterWrite();
        }
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
                showMessage(`Fehler beim Laden der JSON-Datei: ${error}`, 'err');
            } finally {
                event.target.value = null;
            }
        };
        reader.readAsText(file);
    }
});

