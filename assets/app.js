document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration and Constants ---
    const CONFIG = {
        COOLDOWN_DURATION: 2000,
        WRITE_SUCCESS_GRACE_PERIOD: 2500,
        MAX_PAYLOAD_SIZE: 880,
        DEBOUNCE_DELAY: 300,
        MAX_LOG_ENTRIES: 15,
        NFC_WRITE_TIMEOUT: 5000,
        MAX_WRITE_RETRIES: 3,
        BASE_URL: 'https://gunterstruck.github.io/ThiXX/index.html'
    };

    // --- Application State ---
    const appState = {
        translations: {},
        isNfcActionActive: false,
        isCooldownActive: false,
        abortController: null,
        scannedDataObject: null,
        eventLog: [],
        nfcTimeoutId: null,
        gracePeriodTimeoutId: null,
    };

    // --- Design Templates ---
    const designs = {
        'thixx_standard': { appName: "ThiXX NFC Tool", theme: "dark", lockTheme: false, icons: { icon192: "assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#f04e37", secondary: "#6c6b66" } },
        'sigx': { appName: "THiXX NFC Tool", theme: "customer-brand", lockTheme: false, icons: { icon192: "assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#5865F2", secondary: "#3d3d3d" } }
    };
    
    // --- DOM Element References ---
    const tabsContainer = document.querySelector('.tabs');
    const writeTabButton = document.querySelector('.tab-link[data-tab="write-tab"]');
    const tabContents = document.querySelectorAll('.tab-content');
    const nfcStatusBadge = document.getElementById('nfc-status-badge');
    const copyToFormBtn = document.getElementById('copy-to-form-btn');
    const saveJsonBtn = document.getElementById('save-json-btn');
    const loadJsonInput = document.getElementById('load-json-input');
    const loadJsonLabel = document.getElementById('load-json-label');
    const nfcFallback = document.getElementById('nfc-fallback');
    const messageBanner = document.getElementById('message-banner');
    const form = document.getElementById('nfc-write-form');
    const payloadOutput = document.getElementById('payload-output');
    const payloadSize = document.getElementById('payload-size');
    const readResultContainer = document.getElementById('read-result');
    const protocolCard = document.getElementById('protocol-card');
    const rawDataOutput = document.getElementById('raw-data-output');
    const readActions = document.getElementById('read-actions');
    const themeSwitcher = document.querySelector('.theme-switcher');
    const docLinkContainer = document.getElementById('doc-link-container');
    const legalInfoContainer = document.getElementById('legal-info');
    const eventLogOutput = document.getElementById('event-log-output');

    // KORREKTUR: Mapping auf neue snake_case IDs angepasst
    const fieldMap = {
        'hk_nr': 'HK', 'kks': 'KKS', 'leistung': 'P', 'strom': 'I', 'spannung': 'U',
        'widerstand': 'R', 'regler': 'Reg', 'sicherheitsregler_begrenzer': 'Sich',
        'waechter': 'Wäch', 'projekt_nr': 'Proj', 'anzahl_heizkabeleinheiten': 'Anz',
        'trennkasten': 'TB', 'heizkabeltyp': 'HKT', 'schaltung': 'Sch',
        'pt100': 'PT100', 'nicr_ni': 'NiCr', 'geprueft_von': 'Chk', 'am': 'Date',
        'dokumentation': 'Doc'
    };
    const reverseFieldMap = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]));

    // --- Utility Functions ---
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    function isValidDocUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
        } catch { return false; }
    }

    // --- Internationalization (i18n) ---
    function t(key, options = {}) {
        let text = key.split('.').reduce((obj, i) => obj?.[i], appState.translations) || key;
        if (options.replace) {
            Object.entries(options.replace).forEach(([p, v]) => { text = text.replace(`{${p}}`, v); });
        }
        return text;
    }

    async function loadTranslations() {
        const lang = navigator.language.split('-')[0];
        const supportedLangs = ['de', 'en', 'es', 'fr'];
        const selectedLang = supportedLangs.includes(lang) ? lang : 'de';
        // KORREKTUR: Pfad angepasst
        const path = `lang/${selectedLang}.json`;
        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Language file not found at ${path}`);
            appState.translations = await response.json();
            document.documentElement.lang = selectedLang;
        } catch (error) {
            console.error('Translation load failed, falling back to German.', error);
            try {
                const fallbackResponse = await fetch('lang/de.json');
                appState.translations = await fallbackResponse.json();
                document.documentElement.lang = 'de';
            } catch (fallbackError) {
                console.error('Fallback translation failed.', fallbackError);
            }
        }
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
        document.title = t('appTitle');
    }

    // --- Error Handling ---
    class ErrorHandler {
        static handle(error, context = 'General') {
            const readableError = this.getReadableError(error);
            console.error(`[${context}]`, error);
            showMessage(readableError, 'err');
            addLogEntry(`${context}: ${readableError}`, 'err');
            return readableError;
        }
        static getReadableError(error) {
            const errorMap = {
                'NotAllowedError': 'errors.NotAllowedError', 'NotSupportedError': 'errors.NotSupportedError',
                'NotFoundError': 'errors.NotFoundError', 'NotReadableError': 'errors.NotReadableError',
                'NetworkError': 'errors.NetworkError', 'AbortError': 'errors.AbortError',
                'TimeoutError': 'errors.WriteTimeoutError'
            };
            if (error.name === 'NetworkError' && generateUrlFromForm().length > CONFIG.MAX_PAYLOAD_SIZE) {
                return t('messages.payloadTooLarge');
            }
            return t(errorMap[error.name] || 'errors.unknown');
        }
    }

    // --- App Initialization ---
    async function loadConfig() {
        try {
            // KORREKTUR: Pfad angepasst
            const response = await fetch('config.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn('Config load failed, using default.', error);
            return { design: "default" };
        }
    }

    async function main() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                // KORREKTUR: Pfad und Scope angepasst
                navigator.serviceWorker.register('sw.js', { scope: './' })
                    .then(reg => console.log('Service Worker registered:', reg.scope))
                    .catch(err => ErrorHandler.handle(err, 'ServiceWorkerRegistration'));
            });
        }
        await loadTranslations();
        applyTranslations();
        const config = await loadConfig();
        applyConfig(config);
        setupEventListeners();
        setTodaysDate();
        checkNfcSupportAndSetupUI();
        initCollapsibles();
        if (!processUrlParameters()) {
            setupReadTabInitialState();
        }
    }

    main();

    function setupEventListeners() {
        tabsContainer.addEventListener('click', e => {
            const tabLink = e.target.closest('.tab-link');
            if (tabLink) switchTab(tabLink.dataset.tab);
        });
        themeSwitcher.addEventListener('click', e => {
            const themeBtn = e.target.closest('.theme-btn');
            if (themeBtn) applyTheme(themeBtn.dataset.theme);
        });
        nfcStatusBadge.addEventListener('click', handleNfcAction);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonLabel?.addEventListener('click', () => loadJsonInput.click());
        loadJsonInput.addEventListener('change', loadJsonIntoForm);
        form.addEventListener('input', debounce(updatePayloadOnChange, CONFIG.DEBOUNCE_DELAY));
        form.addEventListener('change', updatePayloadOnChange);
        document.getElementById('has_pt100')?.addEventListener('change', e => {
            document.getElementById('pt100').disabled = !e.target.checked;
        });
        document.getElementById('has_nicr_ni')?.addEventListener('change', e => {
            document.getElementById('nicr_ni').disabled = !e.target.checked;
        });
    }

    // --- UI & Display Logic ---
    function createDataPair(labelKey, value, unit = '') {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        const div = document.createElement('div');
        div.className = 'data-pair';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'data-pair-label';
        // Nutze den Original-Key für die Übersetzung
        labelSpan.textContent = t(`form.${labelKey}`);
        const valueSpan = document.createElement('span');
        valueSpan.className = 'data-pair-value';
        valueSpan.textContent = `${value} ${unit}`.trim();
        div.append(labelSpan, valueSpan);
        return div;
    }

    async function displayParsedData(data) {
        protocolCard.innerHTML = '';
        const originalKeys = {
            'hk_nr': 'HK.Nr.', 'kks': 'KKS', 'leistung': 'Leistung', 'strom': 'Strom',
            'spannung': 'Spannung', 'widerstand': 'Widerstand', 'regler': 'Regler',
            'sicherheitsregler_begrenzer': 'Sicherheitsregler/Begrenzer', 'waechter': 'Wächter',
            'projekt_nr': 'Projekt Nr.', 'dokumentation': 'Dokumentation',
            'anzahl_heizkabeleinheiten': 'Anzahl Heizkabeleinheiten', 'trennkasten': 'Trennkasten',
            'heizkabeltyp': 'Heizkabeltyp', 'schaltung': 'Schaltung', 'pt100': 'Messwertgeber', // Placeholder
            'nicr_ni': 'Messwertgeber', // Placeholder
            'geprueft_von': 'geprüft von', 'am': 'am'
        };

        const fragments = { main: document.createDocumentFragment(), section1: document.createDocumentFragment(), section2: document.createDocumentFragment(), section3: document.createDocumentFragment(), footer: document.createDocumentFragment() };
        const addPair = (frag, key, val, unit) => { const el = createDataPair(originalKeys[key] || key, val, unit); if (el) frag.appendChild(el); };
        
        addPair(fragments.main, 'hk_nr', data.hk_nr);
        addPair(fragments.main, 'kks', data.kks);
        addPair(fragments.section1, 'leistung', data.leistung, 'kW');
        addPair(fragments.section1, 'strom', data.strom, 'A');
        addPair(fragments.section1, 'spannung', data.spannung, 'V');
        addPair(fragments.section1, 'widerstand', data.widerstand, 'Ω');
        addPair(fragments.section2, 'anzahl_heizkabeleinheiten', data.anzahl_heizkabeleinheiten, 'Stk');
        addPair(fragments.section2, 'trennkasten', data.trennkasten, 'Stk');
        addPair(fragments.section2, 'heizkabeltyp', data.heizkabeltyp);
        addPair(fragments.section2, 'schaltung', data.schaltung);
        if (data.pt100) addPair(fragments.section2, 'pt100', `PT 100: ${data.pt100}`, 'Stk');
        if (data.nicr_ni) addPair(fragments.section2, 'nicr_ni', `NiCr-Ni: ${data.nicr_ni}`, 'Stk');
        addPair(fragments.section3, 'regler', data.regler, '°C');
        addPair(fragments.section3, 'sicherheitsregler_begrenzer', data.sicherheitsregler_begrenzer, '°C');
        addPair(fragments.section3, 'waechter', data.waechter, '°C');
        addPair(fragments.footer, 'projekt_nr', data.projekt_nr);
        addPair(fragments.footer, 'geprueft_von', data.geprueft_von);
        addPair(fragments.footer, 'am', data.am);
        
        const createSection = (frag, className) => { if(frag.hasChildNodes()) { const section = document.createElement('div'); section.className = className; section.appendChild(frag); protocolCard.appendChild(section); } };
        createSection(fragments.main, 'card-main'); createSection(fragments.section1, 'card-section'); createSection(fragments.section2, 'card-section'); createSection(fragments.section3, 'card-section'); createSection(fragments.footer, 'card-footer');
        
        docLinkContainer.innerHTML = '';
        if (data.dokumentation && isValidDocUrl(data.dokumentation)) {
            const button = document.createElement('button');
            button.className = 'btn doc-link-btn';
            button.dataset.url = data.dokumentation;
            button.textContent = await isUrlCached(data.dokumentation) ? t('docOpenOffline') : (navigator.onLine ? t('docDownload') : t('docDownloadLater'));
            button.addEventListener('click', handleDocButtonClick);
            docLinkContainer.appendChild(button);
        }
    }

    function applyConfig(config) {
        const selectedDesign = designs[config.design] || designs['thixx_standard'];
        updateManifest(selectedDesign);
        applyTheme(selectedDesign.theme);
        if (themeSwitcher) themeSwitcher.classList.toggle('hidden', selectedDesign.lockTheme);
        const customerBtnImg = document.querySelector('.theme-btn[data-theme="customer-brand"] img');
        if (customerBtnImg && selectedDesign.icons?.icon512) customerBtnImg.src = selectedDesign.icons.icon512;
        const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
        if (appleIcon && selectedDesign.icons?.icon192) appleIcon.href = selectedDesign.icons.icon192;
        if (selectedDesign.brandColors?.primary) document.documentElement.style.setProperty('--primary-color-override', selectedDesign.brandColors.primary);
        if (selectedDesign.brandColors?.secondary) document.documentElement.style.setProperty('--secondary-color-override', selectedDesign.brandColors.secondary);
    }

    // --- NFC Logic ---
    async function handleNfcAction() {
        if (appState.isNfcActionActive || appState.isCooldownActive) return;
        appState.isNfcActionActive = true;
        appState.abortController = new AbortController();
        const isWriteMode = document.querySelector('.tab-link[data-tab="write-tab"].active');
        appState.nfcTimeoutId = setTimeout(() => appState.abortController?.abort(new DOMException('NFC Operation Timed Out', 'TimeoutError')), CONFIG.NFC_WRITE_TIMEOUT);

        try {
            const ndef = new NDEFReader();
            if (isWriteMode) {
                const validationErrors = validateForm();
                if (validationErrors.length > 0) throw new Error(validationErrors.join('\n'));
                setNfcBadge('writing');
                const urlPayload = generateUrlFromForm();
                await writeWithRetries(ndef, { records: [{ recordType: "url", data: urlPayload }] });
            } else { // Read mode
                setNfcBadge('scanning');
                showMessage(t('messages.readPrompt'), 'info');
                ndef.onreading = event => {
                    clearTimeout(appState.nfcTimeoutId);
                    try {
                        const urlRecord = event.message.records.find(r => r.recordType === 'url');
                        if (urlRecord) {
                            const url = new TextDecoder().decode(urlRecord.data);
                            if (url.startsWith(CONFIG.BASE_URL)) window.location.href = url;
                            else throw new Error(t('messages.noKnownContent'));
                        } else throw new Error(t('messages.noKnownContent'));
                    } catch (error) {
                        ErrorHandler.handle(error, 'NFCReadCallback');
                    } finally {
                        abortNfcAction();
                        startCooldown();
                    }
                };
                await ndef.scan({ signal: appState.abortController.signal });
            }
        } catch (error) {
            clearTimeout(appState.nfcTimeoutId);
            if (error.name !== 'AbortError') ErrorHandler.handle(error, 'NFCAction');
            else if (error.message === 'NFC Operation Timed Out') ErrorHandler.handle(new DOMException('Write operation timed out.', 'TimeoutError'), 'NFCAction');
            abortNfcAction();
            startCooldown();
        }
    }

    async function writeWithRetries(ndef, message) {
        for (let attempt = 1; attempt <= CONFIG.MAX_WRITE_RETRIES; attempt++) {
            try {
                showMessage(t('messages.writeAttempt', { replace: { attempt, total: CONFIG.MAX_WRITE_RETRIES } }), 'info', CONFIG.NFC_WRITE_TIMEOUT);
                await ndef.write(message, { signal: appState.abortController.signal });
                clearTimeout(appState.nfcTimeoutId);
                setNfcBadge('success', t('status.tagWritten'));
                showMessage(t('messages.writeSuccess'), 'ok');
                appState.gracePeriodTimeoutId = setTimeout(() => { if (appState.gracePeriodTimeoutId !== null) { abortNfcAction(); startCooldown(); } }, CONFIG.WRITE_SUCCESS_GRACE_PERIOD);
                ndef.onreading = () => {};
                ndef.scan({ signal: appState.abortController.signal }).catch(() => {});
                return;
            } catch (error) {
                console.warn(`Write attempt ${attempt} failed:`, error);
                if (attempt === CONFIG.MAX_WRITE_RETRIES || ['TimeoutError', 'AbortError'].includes(error.name)) throw error;
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    // --- Data Processing & Form Handling ---
    function processUrlParameters() {
        const params = new URLSearchParams(window.location.search);
        if (params.toString() === '') return false;
        const data = {};
        for (const [shortKey, value] of params.entries()) {
            const fullKey = reverseFieldMap[shortKey];
            if (fullKey) data[fullKey] = value;
        }
        if (Object.keys(data).length > 0) {
            appState.scannedDataObject = data;
            displayParsedData(data);
            rawDataOutput.value = window.location.href;
            readActions.classList.remove('hidden');
            readResultContainer.classList.add('expanded');
            switchTab('read-tab');
            return true;
        }
        return false;
    }

    function getFormData() {
        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            if (String(value).trim()) data[key] = String(value).trim();
        }
        if (!document.getElementById('has_pt100')?.checked) delete data.pt100;
        if (!document.getElementById('has_nicr_ni')?.checked) delete data.nicr_ni;
        delete data.has_pt100;
        delete data.has_nicr_ni;
        return data;
    }
    
    function generateUrlFromForm() {
        const params = new URLSearchParams();
        const formData = getFormData();
        for (const [key, value] of Object.entries(formData)) {
            const shortKey = fieldMap[key];
            if (shortKey) params.append(shortKey, value);
        }
        return `${CONFIG.BASE_URL}?${params.toString()}`;
    }

    function updatePayloadOnChange() {
        if (document.querySelector('.tab-link[data-tab="write-tab"].active')) {
            const urlPayload = generateUrlFromForm();
            payloadOutput.value = urlPayload;
            const byteCount = new TextEncoder().encode(urlPayload).length;
            payloadSize.textContent = `${byteCount} / ${CONFIG.MAX_PAYLOAD_SIZE} Bytes`;
            const isOverLimit = byteCount > CONFIG.MAX_PAYLOAD_SIZE;
            payloadSize.classList.toggle('limit-exceeded', isOverLimit);
            // KORREKTUR: Button wird bei Überschreitung deaktiviert
            nfcStatusBadge.disabled = isOverLimit;
        }
    }
    
    function validateForm() {
        const errors = [];
        const spannung = form.elements.spannung?.value;
        if (spannung && (spannung < 0 || spannung > 1000)) errors.push(t('errors.invalidVoltage'));
        const docUrl = form.elements.dokumentation?.value;
        if (docUrl && !isValidDocUrl(docUrl)) errors.push(t('errors.invalidDocUrl'));
        if (generateUrlFromForm().length > CONFIG.MAX_PAYLOAD_SIZE) errors.push(t('messages.payloadTooLarge'));
        return errors;
    }

    // --- Helper & State Functions ---
    function startCooldown() {
        appState.isCooldownActive = true;
        setNfcBadge('cooldown');
        setTimeout(() => {
            appState.isCooldownActive = false;
            if ('NDEFReader' in window) setNfcBadge('idle');
        }, CONFIG.COOLDOWN_DURATION);
    }

    function abortNfcAction() {
        clearTimeout(appState.nfcTimeoutId);
        if (appState.gracePeriodTimeoutId) clearTimeout(appState.gracePeriodTimeoutId);
        appState.gracePeriodTimeoutId = null;
        appState.abortController?.abort(new DOMException('User aborted', 'AbortError'));
        appState.abortController = null;
        appState.isNfcActionActive = false;
    }

    // --- Service Worker & Cache ---
    async function isUrlCached(url) {
        if (!('caches' in window)) return false;
        try {
            const cache = await caches.open('thixx-docs-v1');
            const response = await cache.match(new Request(url, { mode: 'no-cors' }));
            return !!response;
        } catch (error) {
            console.error("Cache check failed:", error);
            return false;
        }
    }

    async function handleDocButtonClick(event) {
        const button = event.target;
        const url = button.dataset.url;
        if (navigator.onLine) {
            window.open(url, '_blank');
            button.textContent = t('docOpenOffline');
            button.onclick = () => window.open(url, '_blank');
            navigator.serviceWorker.controller?.postMessage({ action: 'cache-doc', url: url });
        } else {
            showMessage(t('docDownloadLater'), 'info');
        }
    }

    // --- UI/UX Functions ---
    function switchTab(tabId) {
        abortNfcAction();
        document.querySelectorAll('.tab-link').forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`)?.classList.add('active');
        document.getElementById(tabId)?.classList.add('active');
        legalInfoContainer?.classList.toggle('hidden', tabId !== 'read-tab');
        if ('NDEFReader' in window) setNfcBadge('idle');
        if (tabId === 'write-tab') updatePayloadOnChange();
        // KORREKTUR: Fokus-Management hinzugefügt
        requestAnimationFrame(() => {
            const firstFocusable = document.querySelector(
                tabId === 'write-tab' ? '#nfc-write-form input, #nfc-write-form select' : '#read-actions button'
            );
            firstFocusable?.focus();
        });
    }

    function checkNfcSupportAndSetupUI() {
        if ('NDEFReader' in window) {
            setNfcBadge('idle');
        } else {
            setNfcBadge('unsupported');
            nfcFallback?.classList.remove('hidden');
            if (nfcStatusBadge) nfcStatusBadge.disabled = true;
            if (writeTabButton) writeTabButton.classList.add('hidden');
        }
    }
    
    // Unchanged helper functions...
    function showMessage(text, type = 'info', duration = 4000) { messageBanner.textContent = text; messageBanner.className = `message-banner ${type}`; messageBanner.classList.remove('hidden'); setTimeout(() => messageBanner.classList.add('hidden'), duration); addLogEntry(text, type); }
    function setTodaysDate() { const today = new Date().toISOString().split('T')[0]; const dateInput = document.getElementById('am'); if (dateInput) dateInput.value = today; }
    function setNfcBadge(state, message = '') { const isWrite = document.querySelector('.tab-link[data-tab="write-tab"].active'); const states = { unsupported: [t('status.unsupported'), 'err'], idle: [isWrite ? t('status.startWriting') : t('status.startReading'), 'info'], scanning: [t('status.scanning'), 'info'], writing: [t('status.writing'), 'info'], success: [message || t('status.success'), 'ok'], error: [message || t('status.error'), 'err'], cooldown: [t('status.cooldown'), 'info'] }; const [text, className] = states[state] || states.idle; nfcStatusBadge.textContent = text; nfcStatusBadge.className = `nfc-badge ${className}`; }
    function populateFormFromScan() { if (!appState.scannedDataObject) { showMessage(t('messages.noDataToCopy'), 'err'); return; } form.reset(); setTodaysDate(); Object.entries(appState.scannedDataObject).forEach(([key, value]) => { const input = form.elements[key]; if (input) { if (input.type === 'radio') { form.querySelector(`input[name="${key}"][value="${value}"]`)?.setAttribute('checked', true); } else if (input.type === 'checkbox') { input.checked = (value === 'true' || value === 'on'); } else { input.value = value; } } }); ['pt100', 'nicr_ni'].forEach(id => { const hasCheckbox = document.getElementById(`has_${id}`); const numInput = document.getElementById(id); if (numInput && hasCheckbox) { const hasValue = appState.scannedDataObject[id]; hasCheckbox.checked = !!hasValue; numInput.disabled = !hasValue; if (hasValue) numInput.value = hasValue; } }); switchTab('write-tab'); document.getElementById('write-form-container').classList.add('expanded'); showMessage(t('messages.copySuccess'), 'ok'); }
    function saveFormAsJson() { const data = getFormData(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `thixx-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 100); showMessage(t('messages.saveSuccess'), 'ok'); }
    function loadJsonIntoForm(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = e => { try { appState.scannedDataObject = JSON.parse(e.target.result); populateFormFromScan(); showMessage(t('messages.loadSuccess'), 'ok'); } catch (error) { ErrorHandler.handle(error, 'LoadJSON'); } finally { event.target.value = null; } }; reader.readAsText(file); }
    function addLogEntry(message, type = 'info') { const timestamp = new Date().toLocaleTimeString(); appState.eventLog.unshift({ timestamp, message, type }); if (appState.eventLog.length > CONFIG.MAX_LOG_ENTRIES) appState.eventLog.pop(); renderLog(); }
    function renderLog() { if (!eventLogOutput) return; eventLogOutput.innerHTML = appState.eventLog.map(e => `<div class="log-entry ${e.type}"><span class="log-timestamp">${e.timestamp}</span> ${e.message}</div>`).join(''); }
    function makeCollapsible(el) { if (!el || el.dataset.collapsibleApplied) return; el.dataset.collapsibleApplied = 'true'; const toggle = () => el.classList.add('expanded'); const overlay = el.querySelector('.collapsible-overlay'); if (overlay) { overlay.addEventListener('click', e => { e.stopPropagation(); toggle(); }); } el.addEventListener('click', e => { if (!e.target.closest('input, select, textarea, button, label, summary, details, .collapsible-overlay')) toggle(); }); }
    function initCollapsibles() { document.querySelectorAll('.collapsible').forEach(makeCollapsible); }
    function updateManifest(design) { const manifestLink = document.querySelector('link[rel="manifest"]'); if (!manifestLink) return; const oldHref = manifestLink.href; if (oldHref?.startsWith('blob:')) URL.revokeObjectURL(oldHref); const newManifest = { name: design.appName, short_name: design.appName.split(' ')[0], start_url: "./index.html", scope: "./", display: "standalone", background_color: "#ffffff", theme_color: design.brandColors.primary || "#f04e37", orientation: "portrait-primary", icons: [{ src: design.icons.icon192, sizes: "192x192", type: "image/png" }, { src: design.icons.icon512, sizes: "512x512", type: "image/png" }] }; const blob = new Blob([JSON.stringify(newManifest)], { type: 'application/json' }); manifestLink.href = URL.createObjectURL(blob); }
    function applyTheme(themeName) { document.documentElement.setAttribute('data-theme', themeName); localStorage.setItem('thixx-theme', themeName); document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === themeName)); const metaThemeColor = document.querySelector('meta[name="theme-color"]'); if (metaThemeColor) { const colors = { dark: '#0f172a', thixx: '#f8f9fa', 'customer-brand': '#FCFCFD' }; metaThemeColor.content = colors[themeName] || '#FCFCFD'; } }
    function setupReadTabInitialState() { protocolCard.innerHTML = `<p class="placeholder-text">${t('placeholderRead')}</p>`; docLinkContainer.innerHTML = ''; readActions.classList.add('hidden'); }
});
