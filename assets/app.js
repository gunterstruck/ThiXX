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
    const nfcStatusBadge = document.getElementById('nfc-status-badge');
    const writeNfcBtnBottom = document.getElementById('write-nfc-btn-bottom');
    const copyToFormBtn = document.getElementById('copy-to-form-btn');
    const saveJsonBtn = document.getElementById('save-json-btn');
    const loadJsonInput = document.getElementById('load-json-input');
    const nfcFallback = document.getElementById('nfc-fallback');
    const messageBanner = document.getElementById('message-banner');
    const form = document.getElementById('nfc-write-form');
    const payloadOutput = document.getElementById('payload-output');
    const payloadSize = document.getElementById('payload-size');
    const payloadContainer = document.getElementById('payload-container');
    const readResultContainer = document.getElementById('read-result');
    const protocolCard = document.getElementById('protocol-card');
    const rawDataOutput = document.getElementById('raw-data-output');
    const rawDataDetailsContainer = document.getElementById('raw-data-details-container');
    
    // --- Constants ---
    const MAX_PAYLOAD_BYTES = 880;
    const ACTION_COOLDOWN_MS = 2000; // 2 Sekunden Pause nach erfolgreicher Aktion

    // --- State Variables ---
    let scannedDataObject = null;
    let isNfcActionActive = false;
    let isCooldownActive = false;
    let abortController = null;

    // --- Initialization ---
    init();

    function init() {
        setupEventListeners();
        setupTheme();
        setTodaysDate();
        checkNfcSupport();
        initCollapsibles();
        setupReadTabInitialState();
    }
    
    function setupReadTabInitialState() {
        protocolCard.innerHTML = `<p class="placeholder-text">Noch keine Daten gelesen. Bitte NFC-Tag zum Lesen halten.</p>`;
        copyToFormBtn.classList.add('hidden');
        rawDataDetailsContainer.classList.add('hidden');
    }

    function initCollapsibles() {
        document.querySelectorAll('.collapsible').forEach(el => makeCollapsible(el));
    }

    function checkNfcSupport() {
        if ('NDEFReader' in window) {
            setNfcBadge('idle');
        } else {
            setNfcBadge('unsupported');
            nfcFallback.classList.remove('hidden');
            nfcStatusBadge.disabled = true;
            if(writeNfcBtnBottom) writeNfcBtnBottom.disabled = true;
        }
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        nfcStatusBadge.addEventListener('click', handleNfcAction);
        if(writeNfcBtnBottom) writeNfcBtnBottom.addEventListener('click', handleNfcAction);

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
        abortNfcAction();
        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
        
        setNfcBadge('idle');
        if (tabId === 'write-tab') {
            updatePayloadOnChange();
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

    function setNfcBadge(state, message = '') {
        const isWriteMode = document.querySelector('.tab-link[data-tab="write-tab"]').classList.contains('active');
        const states = {
            unsupported: ['NFC nicht unterstützt', 'err'],
            idle: [isWriteMode ? 'Schreiben starten' : 'Lesen starten', 'info'],
            scanning: ['Scannen...', 'info'],
            writing: ['Schreiben...', 'info'],
            success: [message || 'Erfolgreich!', 'ok'],
            error: [message || 'Fehler', 'err'],
            cooldown: ['Bitte warten...', 'info']
        };
        const [text, className] = states[state] || states['idle'];
        
        nfcStatusBadge.textContent = text;
        nfcStatusBadge.className = 'nfc-badge';
        nfcStatusBadge.classList.add(className);
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

    // --- Cooldown Logic ---
    function startCooldown() {
        isCooldownActive = true;
        setNfcBadge('cooldown');
        setTimeout(() => {
            isCooldownActive = false;
            setNfcBadge('idle');
        }, ACTION_COOLDOWN_MS);
    }

    // --- NFC Logic ---
    function abortNfcAction() {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        isNfcActionActive = false;
    }

    async function handleNfcAction() {
        if (isNfcActionActive || isCooldownActive) {
            showMessage('Bitte kurz warten...', 'info', 1500);
            return;
        }

        if (!('NDEFReader' in window)) {
            showMessage('Web NFC wird auf diesem Gerät nicht unterstützt.', 'err');
            return;
        }
        
        isNfcActionActive = true;
        abortController = new AbortController();
        const isWriteMode = document.querySelector('.tab-link[data-tab="write-tab"]').classList.contains('active');

        try {
            const ndef = new NDEFReader();
            
            if (isWriteMode) {
                // --- WRITE LOGIC ---
                setNfcBadge('writing');
                showMessage('Bitte NFC-Tag zum Schreiben an das Gerät halten...', 'info');
                
                generateAndShowPayload();
                const payload = payloadOutput.value;
                const byteCount = new TextEncoder().encode(payload).length;

                if (byteCount > MAX_PAYLOAD_BYTES) {
                    throw new Error('Daten sind zu groß für den NFC-Tag.');
                }

                await ndef.write(payload, { signal: abortController.signal });
                
                setNfcBadge('success', 'Tag geschrieben!');
                showMessage('Daten erfolgreich auf den Tag geschrieben.', 'ok');
                startCooldown();

            } else {
                // --- READ LOGIC ---
                setNfcBadge('scanning');
                showMessage('Bitte NFC-Tag zum Lesen an das Gerät halten...', 'info');

                await ndef.scan({ signal: abortController.signal });
                ndef.onreading = (event) => {
                    abortNfcAction(); // Stop scanning immediately after first read
                    const firstRecord = event.message.records[0];
                    if (firstRecord && firstRecord.recordType === 'text') {
                        const textDecoder = new TextDecoder(firstRecord.encoding || 'utf-8');
                        const text = textDecoder.decode(firstRecord.data);
                        processNfcData(text);
                        setNfcBadge('success', 'Tag gelesen!');
                        showMessage('NFC-Tag erfolgreich gelesen!', 'ok');
                    } else {
                        throw new Error('Kein Text auf dem Tag gefunden.');
                    }
                    startCooldown();
                };
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                const readableError = getReadableError(error);
                setNfcBadge('error', readableError);
                showMessage(readableError, 'err');
                startCooldown(); // Start cooldown even on error to prevent rapid retries
            } else {
                setNfcBadge('idle'); // Reset if user aborted
            }
        } finally {
            isNfcActionActive = false;
        }
    }

    function processNfcData(text) {
        rawDataOutput.value = text;
        try {
            scannedDataObject = parseNfcText(text);
            displayParsedData(scannedDataObject);
            copyToFormBtn.classList.remove('hidden');
            rawDataDetailsContainer.classList.remove('hidden');
        } catch(e) {
            showMessage(`Fehler beim Verarbeiten: ${e.message}`, 'err');
            setupReadTabInitialState();
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
            if (Object.keys(data).length === 0) throw new Error("v1-Format, aber keine Daten gefunden.");
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

    // --- Form & Data Handling ---
    function updatePayloadOnChange() {
        if (document.querySelector('.tab-link[data-tab="write-tab"]').classList.contains('active')) {
            generateAndShowPayload();
        }
    }
    
    function generateAndShowPayload() {
        const formData = getFormData();
        const payload = formatToCompact(formData);
        payloadOutput.value = payload;

        const byteCount = new TextEncoder().encode(payload).length;
        payloadSize.textContent = `${byteCount} / ${MAX_PAYLOAD_BYTES} Bytes`;
        
        payloadSize.classList.toggle('limit-exceeded', byteCount > MAX_PAYLOAD_BYTES);
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
        const today = new Date().toISOString().slice(0, 10);
        a.download = `thixx-${today}.json`;
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
    
    // --- Collapsible helpers ---
    function makeCollapsible(el) {
        if (!el || el.dataset.collapsibleApplied) return;
        el.dataset.collapsibleApplied = 'true';
        const toggle = () => {
            if (el.classList.contains('expanded')) return;
            el.classList.add('expanded');
        };
        const overlay = el.querySelector('.collapsible-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation(); toggle();
            });
        }
        el.addEventListener('click', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (['input', 'select', 'textarea', 'button', 'label', 'summary', 'details'].includes(tag) || 
                e.target.closest('.collapsible-overlay')) return;
            toggle();
        });
    }

    // --- Field Mappings ---
    const fieldMap = {
        'HK.Nr.': 'HK', 'KKS': 'KKS', 'Leistung': 'P', 'Strom': 'I', 'Spannung': 'U', 
        'Widerstand': 'R', 'Regler': 'Reg', 'Sicherheitsregler/Begrenzer': 'Sich', 
        'Wächter': 'Wäch', 'Projekt Nr.': 'Proj', 'Anzahl Heizkabeleinheiten': 'Anz', 
        'Trennkasten': 'TB', 'Heizkabeltyp': 'HKT', 'Schaltung': 'Sch',
        'PT 100': 'PT100', 'NiCr-Ni': 'NiCr', 'geprüft von': 'Chk', 'am': 'Date'
    };
    const reverseFieldMap = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]));
});
