document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration and Constants ---
    const CONFIG = {
        COOLDOWN_DURATION: 2000,
        // NEU: Eine 2.5-sekündige Schonfrist nach erfolgreichem Schreiben,
        // um zu verhindern, dass das Betriebssystem die Kontrolle übernimmt.
        WRITE_SUCCESS_GRACE_PERIOD: 2500,
        MAX_PAYLOAD_SIZE: 880,
        DEBOUNCE_DELAY: 300,
        MAX_LOG_ENTRIES: 15,
        NFC_WRITE_TIMEOUT: 5000,
        MAX_WRITE_RETRIES: 3,
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
    };

    // --- Design Templates ---
    const designs = {
        'thixx_standard': { appName: "ThiXX NFC Tool", theme: "dark", lockTheme: false, icons: { icon192: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#f04e37", secondary: "#6c6b66" } },
        'sigx': { appName: "THiXX NFC Tool", theme: "customer-brand", lockTheme: false, icons: { icon192: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#5865F2", secondary: "#3d3d3d" } }
    };

    // --- DOM Element References ---
    const tabsContainer = document.querySelector('.tabs');
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

    // --- Utility Functions ---
    const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };
    
    function isValidDocUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
        } catch {
            return false;
        }
    }

    // --- Internationalization (i18n) ---
    function t(key, options = {}) {
        let text = key.split('.').reduce((obj, i) => obj?.[i], appState.translations);
        if (!text) {
            console.warn(`Translation not found for key: ${key}`);
            return key;
        }
        if (options.replace) {
            for (const [placeholder, value] of Object.entries(options.replace)) {
                text = text.replace(`{${placeholder}}`, value);
            }
        }
        return text;
    }

    async function loadTranslations() {
        const lang = navigator.language.split('-')[0];
        const supportedLangs = ['de', 'en', 'es', 'fr'];
        const selectedLang = supportedLangs.includes(lang) ? lang : 'de';
        const path = `/ThiXX/lang/${selectedLang}.json`;

        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Language file for ${selectedLang} not found at ${path}`);
            appState.translations = await response.json();
            document.documentElement.lang = selectedLang;
        } catch (error) {
            console.error('Could not load translations, falling back to German.', error);
            try {
                const fallbackPath = `/ThiXX/lang/de.json`;
                const response = await fetch(fallbackPath);
                appState.translations = await response.json();
                document.documentElement.lang = 'de';
            } catch (fallbackError) {
                console.error('Could not load fallback German translations.', fallbackError);
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
                'NotAllowedError': 'errors.NotAllowedError',
                'NotSupportedError': 'errors.NotSupportedError',
                'NotFoundError': 'errors.NotFoundError',
                'NotReadableError': 'errors.NotReadableError',
                'NetworkError': 'errors.NetworkError',
                'AbortError': 'errors.AbortError',
                'TimeoutError': 'errors.WriteTimeoutError'
            };
            
            if (error.name === 'NetworkError') {
                 const payloadByteSize = new TextEncoder().encode(payloadOutput.value).length;
                 if (payloadByteSize > CONFIG.MAX_PAYLOAD_SIZE) {
                     return t('messages.payloadTooLarge');
                 }
            }
            
            return t(errorMap[error.name] || 'errors.unknown');
        }
    }

    // --- App Initialization ---
    async function loadConfig() {
        try {
            const response = await fetch('/ThiXX/config.json');
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
                navigator.serviceWorker.register('/ThiXX/sw.js', { scope: '/ThiXX/' })
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
        checkNfcSupport();
        initCollapsibles();
        setupReadTabInitialState();
        switchTab('read-tab'); 
    }

    main();

    function setupEventListeners() {
        tabsContainer.addEventListener('click', (e) => {
            const tabLink = e.target.closest('.tab-link');
            if (tabLink) switchTab(tabLink.dataset.tab);
        });
        themeSwitcher.addEventListener('click', (e) => {
            const themeBtn = e.target.closest('.theme-btn');
            if (themeBtn) applyTheme(themeBtn.dataset.theme);
        });

        nfcStatusBadge.addEventListener('click', handleNfcAction);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        
        if (loadJsonLabel) {
            loadJsonLabel.addEventListener('click', () => {
                loadJsonInput.click();
            });
        }
        loadJsonInput.addEventListener('change', loadJsonIntoForm);
        
        form.addEventListener('input', debounce(updatePayloadOnChange, CONFIG.DEBOUNCE_DELAY));
        form.addEventListener('change', updatePayloadOnChange);
        
        document.getElementById('has_PT100')?.addEventListener('change', (e) => {
            const el = document.getElementById('PT 100');
            if (el) el.disabled = !e.target.checked;
        });
        document.getElementById('has_NiCr-Ni')?.addEventListener('change', (e) => {
            const el = document.getElementById('NiCr-Ni');
            if (el) el.disabled = !e.target.checked;
        });
    }

    // --- UI & Display Logic ---
    function createDataPair(label, value, unit = '') {
        if (value === undefined || value === null || value === '') return null;
        const div = document.createElement('div');
        div.className = 'data-pair';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'data-pair-label';
        labelSpan.textContent = label;
        const valueSpan = document.createElement('span');
        valueSpan.className = 'data-pair-value';
        valueSpan.textContent = `${value} ${unit}`.trim();
        div.appendChild(labelSpan);
        div.appendChild(valueSpan);
        return div;
    }
    
    async function displayParsedData(data) {
        protocolCard.innerHTML = '';
        const fragments = { main: document.createDocumentFragment(), section1: document.createDocumentFragment(), section2: document.createDocumentFragment(), section3: document.createDocumentFragment(), footer: document.createDocumentFragment() };
        const addPair = (frag, label, val, unit) => { const el = createDataPair(label, val, unit); if (el) frag.appendChild(el); };
        addPair(fragments.main, t('form.HK.Nr.'), data['HK.Nr.']);
        addPair(fragments.main, t('form.KKS'), data['KKS']);
        addPair(fragments.section1, t('form.Leistung'), data['Leistung'], 'kW');
        addPair(fragments.section1, t('form.Strom'), data['Strom'], 'A');
        addPair(fragments.section1, t('form.Spannung'), data['Spannung'], 'V');
        addPair(fragments.section1, t('form.Widerstand'), data['Widerstand'], 'Ω');
        addPair(fragments.section2, t('form.Anzahl Heizkabeleinheiten'), data['Anzahl Heizkabeleinheiten'], 'Stk');
        addPair(fragments.section2, t('form.Trennkasten'), data['Trennkasten'], 'Stk');
        addPair(fragments.section2, t('form.Heizkabeltyp'), data['Heizkabeltyp']);
        addPair(fragments.section2, t('form.Schaltung'), data['Schaltung']);
        addPair(fragments.section2, 'PT 100', data['PT 100'], 'Stk');
        addPair(fragments.section2, 'NiCr-Ni', data['NiCr-Ni'], 'Stk');
        addPair(fragments.section3, t('form.Regler'), data['Regler'], '°C');
        addPair(fragments.section3, t('form.Sicherheitsregler/Begrenzer'), data['Sicherheitsregler/Begrenzer'], '°C');
        addPair(fragments.section3, t('form.Wächter'), data['Wächter'], '°C');
        addPair(fragments.footer, t('form.Projekt Nr.'), data['Projekt Nr.']);
        addPair(fragments.footer, t('form.geprüft von'), data['geprüft von']);
        addPair(fragments.footer, t('form.am'), data['am']);
        const createSection = (frag, className) => { if(frag.hasChildNodes()) { const section = document.createElement('div'); section.className = className; section.appendChild(frag); protocolCard.appendChild(section); } };
        createSection(fragments.main, 'card-main'); createSection(fragments.section1, 'card-section'); createSection(fragments.section2, 'card-section'); createSection(fragments.section3, 'card-section'); createSection(fragments.footer, 'card-footer');
        docLinkContainer.innerHTML = '';
        if (data['Dokumentation']) {
            const url = data['Dokumentation'];
            if (!isValidDocUrl(url)) {
                console.warn('Invalid documentation URL provided:', url);
                return;
            }
            const button = document.createElement('button');
            button.className = 'btn doc-link-btn';
            button.dataset.url = url;
            const isCached = await isUrlCached(url);
            if (isCached) {
                button.textContent = t('docOpenOffline');
                button.onclick = () => window.open(url, '_blank');
            } else {
                button.textContent = navigator.onLine ? t('docDownload') : t('docDownloadLater');
                button.addEventListener('click', handleDocButtonClick);
            }
            docLinkContainer.appendChild(button);
        }
    }
    
    function applyConfig(config) { 
        const selectedDesign = designs[config.design] || designs['default'];
        updateManifest(selectedDesign); 
        applyTheme(selectedDesign.theme); 
        if (selectedDesign.lockTheme) { if (themeSwitcher) themeSwitcher.classList.add('hidden'); } else { if (themeSwitcher) themeSwitcher.classList.remove('hidden'); } 
        const customerBtnImg = document.querySelector('.theme-btn[data-theme="customer-brand"] img'); 
        if (customerBtnImg && selectedDesign.icons?.icon512) { customerBtnImg.src = selectedDesign.icons.icon512; } 
        const appleIcon = document.querySelector('link[rel="apple-touch-icon"]'); 
        if (appleIcon && selectedDesign.icons?.icon192) { appleIcon.href = selectedDesign.icons.icon192; } 
        if (selectedDesign.brandColors?.primary) { document.documentElement.style.setProperty('--primary-color-override', selectedDesign.brandColors.primary); } 
        if (selectedDesign.brandColors?.secondary) { document.documentElement.style.setProperty('--secondary-color-override', selectedDesign.brandColors.secondary); } 
    }

    // --- NFC Logic & Data Processing ---
    function validateForm() {
        const errors = [];
        const voltage = parseFloat(form.elements['Spannung']?.value);
        if (voltage && (voltage < 0 || voltage > 1000)) {
            errors.push(t('errors.invalidVoltage'));
        }
        const docUrl = form.elements['Dokumentation']?.value;
        if (docUrl && !isValidDocUrl(docUrl)) {
            errors.push(t('errors.invalidDocUrl'));
        }
        generateAndShowPayload();
        const payloadByteSize = new TextEncoder().encode(payloadOutput.value).length;
        if (payloadByteSize > CONFIG.MAX_PAYLOAD_SIZE) {
            errors.push(t('messages.payloadTooLarge'));
        }
        return errors;
    }

    async function handleNfcAction() {
        if (appState.isNfcActionActive || appState.isCooldownActive) return;
        if (!('NDEFReader' in window)) {
            showMessage(t('messages.nfcNotSupported'), 'err');
            return;
        }

        appState.isNfcActionActive = true;
        appState.abortController = new AbortController();
        const isWriteMode = document.querySelector('.tab-link[data-tab="write-tab"].active');

        appState.nfcTimeoutId = setTimeout(() => {
            if (appState.abortController && !appState.abortController.signal.aborted) {
                appState.abortController.abort(new DOMException('NFC Operation Timed Out', 'TimeoutError'));
            }
        }, CONFIG.NFC_WRITE_TIMEOUT);

        try {
            const ndef = new NDEFReader();
            if (isWriteMode) {
                const validationErrors = validateForm();
                if (validationErrors.length > 0) {
                    throw new Error(validationErrors.join('\n'));
                }
                
                setNfcBadge('writing');

                const payload = payloadOutput.value;
                const message = {
                    records: [{
                        recordType: "text",
                        data: payload,
                        lang: document.documentElement.lang || 'de'
                    }]
                };

                for (let attempt = 1; attempt <= CONFIG.MAX_WRITE_RETRIES; attempt++) {
                    try {
                        showMessage(t('messages.writeAttempt', { replace: { attempt, total: CONFIG.MAX_WRITE_RETRIES } }), 'info', CONFIG.NFC_WRITE_TIMEOUT);
                        await ndef.write(message, { signal: appState.abortController.signal });
                        clearTimeout(appState.nfcTimeoutId);
                        
                        // --- NEUE "GRACE PERIOD" LOGIK ---
                        // 1. Erfolg sofort dem Nutzer anzeigen.
                        setNfcBadge('success', t('status.tagWritten'));
                        showMessage(t('messages.writeSuccess'), 'ok');
                        
                        // 2. Einen Timer für die Schonfrist starten.
                        setTimeout(() => {
                            if (appState.isNfcActionActive) {
                                abortNfcAction();
                                startCooldown();
                            }
                        }, CONFIG.WRITE_SUCCESS_GRACE_PERIOD);

                        // 3. Einen stillen Scan starten, um den NFC-Leser zu blockieren.
                        // Der onreading-Handler ist leer, da wir nichts tun wollen.
                        ndef.onreading = () => {};
                        ndef.scan({ signal: appState.abortController.signal }).catch(error => {
                            // Ein AbortError wird hier erwartet und ist normal.
                            if (error.name !== 'AbortError') {
                                console.warn("Silent scan during grace period caught an unexpected error:", error);
                            }
                        });
                        
                        return; // Wichtig: Die Funktion hier beenden. Der Timeout kümmert sich um den Rest.

                    } catch (error) {
                        console.warn(`Write attempt ${attempt} failed:`, error);
                        if (attempt === CONFIG.MAX_WRITE_RETRIES || error.name === 'TimeoutError' || error.name === 'AbortError') {
                            throw error;
                        }
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }

            } else { // Read mode
                setNfcBadge('scanning');
                showMessage(t('messages.readPrompt'), 'info');
                ndef.onreading = (event) => {
                    clearTimeout(appState.nfcTimeoutId);
                    try {
                        const textRecord = event.message.records.find(r => r.recordType === 'text');
                        if (textRecord) {
                            const text = new TextDecoder().decode(textRecord.data);
                            processNfcData(text);
                            setNfcBadge('success', t('status.tagRead'));
                            showMessage(t('messages.readSuccess'), 'ok');
                        } else {
                            if (event.message.records.length === 0) throw new Error(t('errors.tagEmpty'));
                            throw new Error(t('messages.noKnownContent'));
                        }
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
            if (error.name !== 'AbortError') {
                ErrorHandler.handle(error, 'NFCAction');
            } else if (error.message === 'NFC Operation Timed Out') {
                 const timeoutError = new DOMException('Write operation timed out.', 'TimeoutError');
                 ErrorHandler.handle(timeoutError, 'NFCAction');
            }
            abortNfcAction();
            startCooldown();
        }
    }
    
    function sanitizeNfcData(data) {
        const sanitized = {};
        const allowedFields = new Set([...Object.keys(fieldMap), ...Object.values(fieldMap)]);
        for (const [key, value] of Object.entries(data)) {
            if (!allowedFields.has(key)) continue;
            let sanitizedValue = String(value).trim().replace(/[<>]/g, '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 200); 
            if (key === 'Dokumentation' && !isValidDocUrl(sanitizedValue)) continue;
            sanitized[key] = sanitizedValue;
        }
        return sanitized;
    }
    
    function processNfcData(text) {
        rawDataOutput.value = text;
        try {
            let parsedData = parseNfcText(text);
            appState.scannedDataObject = sanitizeNfcData(parsedData);
            displayParsedData(appState.scannedDataObject);
            readActions.classList.remove('hidden');
            readResultContainer.classList.add('expanded');
        } catch (e) {
            showMessage(t('messages.processingError', { replace: { message: e.message } }), 'err');
            setupReadTabInitialState();
            appState.scannedDataObject = null;
        }
    }
    
    function startCooldown(){
        appState.isCooldownActive=true;
        setNfcBadge('cooldown');
        setTimeout(()=>{
            appState.isCooldownActive=false;
            if ('NDEFReader' in window) setNfcBadge('idle');
        }, CONFIG.COOLDOWN_DURATION)
    }

    function abortNfcAction(){
        clearTimeout(appState.nfcTimeoutId);
        if(appState.abortController && !appState.abortController.signal.aborted){
            appState.abortController.abort(new DOMException('User aborted', 'AbortError'));
        }
        appState.abortController=null;
        appState.isNfcActionActive=false;
    }

    function addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        appState.eventLog.unshift({ timestamp, message, type });
        if (appState.eventLog.length > CONFIG.MAX_LOG_ENTRIES) appState.eventLog.pop();
        renderLog();
    }

    function renderLog() {
        if (!eventLogOutput) return;
        eventLogOutput.innerHTML = '';
        appState.eventLog.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry ${entry.type}`;
            const timestamp = document.createElement('span');
            timestamp.className = 'log-timestamp';
            timestamp.textContent = entry.timestamp;
            const message = document.createTextNode(` ${entry.message}`);
            div.appendChild(timestamp);
            div.appendChild(message);
            eventLogOutput.appendChild(div);
        });
    }

    async function isUrlCached(url) { 
        if (!('caches' in window)) return false; 
        try { 
            const cache = await caches.open('thixx-docs-v1'); // Use constant name
            const request = new Request(url, { mode: 'no-cors' });
            const response = await cache.match(request); 
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

            if (navigator.serviceWorker.controller) { 
                navigator.serviceWorker.controller.postMessage({ action: 'cache-doc', url: url }); 
            } 
        } else { 
            showMessage(t('docDownloadLater'), 'info'); 
            button.textContent = t('docDownloadPending'); 
            button.disabled = true; 
        } 
    }
    
    function updateManifest(design) { const manifestLink = document.querySelector('link[rel="manifest"]'); if (!manifestLink) return; const newManifest = { name: design.appName, short_name: design.appName.split(' ')[0], start_url: "/ThiXX/index.html", scope: "/ThiXX/", display: "standalone", background_color: "#ffffff", theme_color: design.brandColors.primary || "#f04e37", orientation: "portrait-primary", icons: [{ src: design.icons.icon192, sizes: "192x192", type: "image/png" }, { src: design.icons.icon512, sizes: "512x512", type: "image/png" }] }; const blob = new Blob([JSON.stringify(newManifest)], { type: 'application/json' }); manifestLink.href = URL.createObjectURL(blob); }
    

function applyTheme(themeName) { const themeButtons = document.querySelectorAll('.theme-btn'); document.documentElement.setAttribute('data-theme', themeName); localStorage.setItem('thixx-theme', themeName); themeButtons.forEach(btn => { btn.classList.toggle('active', btn.dataset.theme === themeName); }); const metaThemeColor = document.querySelector('meta[name="theme-color"]'); if (metaThemeColor) { const colors = { dark: '#0f172a', thixx: '#f8f9fa', 'customer-brand': '#FCFCFD' }; metaThemeColor.setAttribute('content', colors[themeName] || '#FCFCFD'); } }
    
    function setupReadTabInitialState(){ 
        protocolCard.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'placeholder-text';
        p.textContent = t('placeholderRead');
        protocolCard.appendChild(p);
        docLinkContainer.innerHTML = '';
        readActions.classList.add('hidden');
    }
    
    function initCollapsibles(){ document.querySelectorAll('.collapsible').forEach(el=>makeCollapsible(el)) }
    
    function checkNfcSupport(){ if('NDEFReader' in window){ setNfcBadge('idle') } else { setNfcBadge('unsupported'); nfcFallback.classList.remove('hidden'); nfcStatusBadge.disabled=true } }
    
    function switchTab(tabId) { 
        abortNfcAction(); 
        document.querySelectorAll('.tab-link').forEach(tab => tab.classList.remove('active')); 
        tabContents.forEach(content => content.classList.remove('active')); 
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active'); 
        document.getElementById(tabId).classList.add('active'); 
        if (legalInfoContainer) { 
            legalInfoContainer.classList.toggle('hidden', tabId !== 'read-tab');
        } 
        if ('NDEFReader' in window) setNfcBadge('idle'); 
        if (tabId === 'write-tab') updatePayloadOnChange(); 
    }
    
    function showMessage(text,type='info',duration=4000){ messageBanner.textContent=text; messageBanner.className='message-banner'; messageBanner.classList.add(type); messageBanner.classList.remove('hidden'); setTimeout(()=>messageBanner.classList.add('hidden'),duration); addLogEntry(text, type); }
    
    function setTodaysDate(){ const today=new Date(); const yyyy=today.getFullYear(); const mm=String(today.getMonth()+1).padStart(2,'0'); const dd=String(today.getDate()).padStart(2,'0'); document.getElementById('am').value=`${yyyy}-${mm}-${dd}` }
    
    function setNfcBadge(state,message=''){ const isWriteMode=document.querySelector('.tab-link[data-tab="write-tab"].active'); const states={ unsupported: [t('status.unsupported'), 'err'], idle: [isWriteMode ? t('status.startWriting') : t('status.startReading'), 'info'], scanning: [t('status.scanning'), 'info'], writing: [t('status.writing'), 'info'], success: [message || t('status.success'), 'ok'], error: [message || t('status.error'), 'err'], cooldown: [t('status.cooldown'), 'info'] }; const[text,className]=states[state]||states['idle']; nfcStatusBadge.textContent=text; nfcStatusBadge.className='nfc-badge'; nfcStatusBadge.classList.add(className) }
    
    function parseNfcText(text){ const data={}; text=text.trim(); if (text === '') { throw new Error(t('errors.tagEmpty')); } if(text.startsWith('v1')){ const content=text.substring(2).trim(); if (content === '') { return {}; } const regex=/([^:\n]+):([^\n]*)/g; let match; while((match=regex.exec(content))!==null){ const key=reverseFieldMap[match[1].trim()]||match[1].trim(); data[key]=match[2].trim() } if(Object.keys(data).length===0)throw new Error(t('errors.v1NoData')); return data } throw new Error(t('errors.unknownFormat')) }
    
    function updatePayloadOnChange(){ if(document.querySelector('.tab-link[data-tab="write-tab"].active')){ generateAndShowPayload() } }
    
    function generateAndShowPayload(){ const formData=getFormData(); const payload=formatToCompact(formData); payloadOutput.value=payload; const byteCount=new TextEncoder().encode(payload).length; payloadSize.textContent=`${byteCount} / ${CONFIG.MAX_PAYLOAD_SIZE} Bytes`; payloadSize.classList.toggle('limit-exceeded',byteCount>CONFIG.MAX_PAYLOAD_SIZE) }
    
    function getFormData(){ const formData=new FormData(form); const data={}; for(const[key,value]of formData.entries()){ if(value.trim())data[key]=value.trim() } if(!document.getElementById('has_PT100').checked)delete data['PT 100']; if(!document.getElementById('has_NiCr-Ni').checked)delete data['NiCr-Ni']; delete data['has_PT100']; delete data['has_NiCr-Ni']; return data }
    
    function formatToCompact(data){ let compactString='v1'; const parts=[]; for(const[key,shortKey]of Object.entries(fieldMap)){ if(data[key])parts.push(`${shortKey}:${data[key]}`) } if(parts.length>0)compactString+='\n'+parts.join('\n'); return compactString }
    
    function populateFormFromScan(){ if(!appState.scannedDataObject){ showMessage(t('messages.noDataToCopy'),'err'); return } form.reset(); setTodaysDate(); for(const[key,value]of Object.entries(appState.scannedDataObject)){ const input=form.elements[key]; if(input){ if(input.type==='radio'){ form.querySelectorAll(`input[name="${key}"]`).forEach(radio=>{ if(radio.value===value)radio.checked=true }) }else if(input.type==='checkbox'){ input.checked=(value==='true'||value==='on') }else{ input.value=value } } } const pt100Input=document.getElementById('PT 100'); const hasPt100Checkbox=document.getElementById('has_PT100'); if(appState.scannedDataObject['PT 100']){ pt100Input.value=appState.scannedDataObject['PT 100']; pt100Input.disabled=false; hasPt100Checkbox.checked=true }else{ pt100Input.disabled=true; hasPt100Checkbox.checked=false } const niCrInput=document.getElementById('NiCr-Ni'); const hasNiCrCheckbox=document.getElementById('has_NiCr-Ni'); if(appState.scannedDataObject['NiCr-Ni']){ niCrInput.value=appState.scannedDataObject['NiCr-Ni']; niCrInput.disabled=false; hasNiCrCheckbox.checked=true }else{ niCrInput.disabled=true; hasNiCrCheckbox.checked=false } switchTab('write-tab'); document.getElementById('write-form-container').classList.add('expanded'); showMessage(t('messages.copySuccess'),'ok') }
    
    function saveFormAsJson(){ const data=getFormData(); const jsonString=JSON.stringify(data,null,2); const blob=new Blob([jsonString],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; const today=new Date().toISOString().slice(0,10); a.download=`thixx-${today}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); showMessage(t('messages.saveSuccess'),'ok') }
    
    function loadJsonIntoForm(event){ const file=event.target.files[0]; if(!file)return; const reader=new FileReader(); reader.onload=(e)=>{ try{ const data=JSON.parse(e.target.result); appState.scannedDataObject=data; populateFormFromScan(); showMessage(t('messages.loadSuccess'),'ok') }catch(error){ ErrorHandler.handle(error, 'LoadJSON'); }finally{ event.target.value=null } }; reader.readAsText(file) }
    
    function makeCollapsible(el){ if(!el||el.dataset.collapsibleApplied)return; el.dataset.collapsibleApplied='true'; const toggle=()=>{ if(el.classList.contains('expanded'))return; el.classList.add('expanded') }; const overlay=el.querySelector('.collapsible-overlay'); if(overlay){ overlay.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); toggle() }) } el.addEventListener('click',(e)=>{ const tag=(e.target.tagName||'').toLowerCase(); if(['input','select','textarea','button','label','summary','details'].includes(tag)||e.target.closest('.collapsible-overlay'))return; toggle() }) }
    
    const fieldMap={ 'HK.Nr.':'HK', 'KKS':'KKS', 'Leistung':'P', 'Strom':'I', 'Spannung':'U', 'Widerstand':'R', 'Regler':'Reg', 'Sicherheitsregler/Begrenzer':'Sich', 'Wächter':'Wäch', 'Projekt Nr.':'Proj', 'Anzahl Heizkabeleinheiten':'Anz', 'Trennkasten':'TB', 'Heizkabeltyp':'HKT', 'Schaltung':'Sch', 'PT 100':'PT100', 'NiCr-Ni':'NiCr', 'geprüft von':'Chk', 'am':'Date', 'Dokumentation': 'Doc' };
    const reverseFieldMap=Object.fromEntries(Object.entries(fieldMap).map(([k,v])=>[v,k]));

});
