document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration and Constants ---
    const SCOPE = '/ThiXX/';
    const BASE_URL = new URL('index.html', location.origin + SCOPE).href;
    const CONFIG = {
        COOLDOWN_DURATION: 2000,
        WRITE_SUCCESS_GRACE_PERIOD: 2500,
        MAX_PAYLOAD_SIZE: 880,
        DEBOUNCE_DELAY: 300,
        MAX_LOG_ENTRIES: 15,
        NFC_WRITE_TIMEOUT: 5000,
        MAX_WRITE_RETRIES: 3,
        BASE_URL: BASE_URL,
        SAFETY_BUFFER_PX: 10 // Puffer für die System-Navigationsleiste
    };

    // --- Application State ---
    const appState = {
        translations: {}, isNfcActionActive: false, isCooldownActive: false,
        abortController: null, scannedDataObject: null, eventLog: [],
        nfcTimeoutId: null, gracePeriodTimeoutId: null,
    };

    // --- Design Templates ---
    const designs = {
        'thixx_standard': { appName: "ThiXX NFC Tool", short_name: "ThiXX", theme: "dark", lockTheme: false, icons: { icon192: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#f04e37", secondary: "#6c6b66" } },
        'sigx': { appName: "THiXX NFC Tool", short_name: "THiXX", theme: "customer-brand", lockTheme: false, icons: { icon192: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#5865F2", secondary: "#3d3d3d" } },
        'othimm': { appName: "O.Thimm NFC Tool", short_name: "O.Thimm", theme: "customer-brand", lockTheme: false, icons: { icon192: "/ThiXX/assets/icon-192.png", icon512: "/ThiXX/assets/icon-512.png" }, brandColors: { primary: "#d54b2a", secondary: "#6C6B66" } }
    };

    // --- DOM Element References ---
    const headerElement = document.querySelector('header');
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
    const updateBanner = document.getElementById('update-banner');
    const reloadButton = document.getElementById('reload-button');
    const checkForUpdateBtn = document.getElementById('check-for-update-btn');

    // --- Data Mapping ---
    const fieldMap = { 'HK-Nr': 'HK', 'KKS': 'KKS', 'Leistung': 'P', 'Strom': 'I', 'Spannung': 'U', 'Widerstand': 'R', 'Regler': 'Reg', 'Sicherheitsregler/Begrenzer': 'Sich', 'Wächter': 'Wäch', 'Projekt-Nr': 'Proj', 'Anzahl Heizkabeleinheiten': 'Anz', 'Trennkasten': 'TB', 'Heizkabeltyp': 'HKT', 'Schaltung': 'Sch', 'PT 100': 'PT100', 'NiCr-Ni': 'NiCr', 'geprüft von': 'Chk', 'am': 'Date', 'Dokumentation': 'Doc' };
    const reverseFieldMap = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]));

    // --- Utility Functions ---
    const debounce = (func, wait) => { let timeout; return function executedFunction(...args) { const later = () => { clearTimeout(timeout); func.apply(this, args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); }; };
    function isValidDocUrl(url) { if (!url || typeof url !== 'string') return false; try { const parsed = new URL(url); return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')); } catch { return false; } }
    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // --- Internationalization (i18n) ---
    function t(key, options = {}) { let text = key.split('.').reduce((obj, i) => obj?.[i], appState.translations); if (!text) { console.warn(`Translation not found for key: ${key}`); return key; } if (options.replace) { for (const [placeholder, value] of Object.entries(options.replace)) { text = text.replace(`{${placeholder}}`, value); } } return text; }
    async function loadTranslations() { const lang = navigator.language.split('-')[0]; const supportedLangs = ['de', 'en', 'es', 'fr']; const selectedLang = supportedLangs.includes(lang) ? lang : 'de'; const path = `/ThiXX/lang/${selectedLang}.json`; try { const response = await fetch(path); if (!response.ok) throw new Error(`Language file for ${selectedLang} not found at ${path}`); appState.translations = await response.json(); document.documentElement.lang = selectedLang; } catch (error) { console.error('Could not load translations, falling back to German.', error); try { const fallbackPath = `/ThiXX/lang/de.json`; const response = await fetch(fallbackPath); appState.translations = await response.json(); document.documentElement.lang = 'de'; } catch (fallbackError) { console.error('Could not load fallback German translations.', fallbackError); } } }
    function applyTranslations() { document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); }); document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); }); document.title = t('appTitle'); }

    // --- Error Handling ---
    class ErrorHandler { static handle(error, context = 'General') { const readableError = this.getReadableError(error); console.error(`[${context}]`, error); showMessage(readableError, 'err'); addLogEntry(`${context}: ${readableError}`, 'err'); return readableError; } static getReadableError(error) { const errorMap = { 'NotAllowedError': 'errors.NotAllowedError', 'NotSupportedError': 'errors.NotSupportedError', 'NotFoundError': 'errors.NotFoundError', 'NotReadableError': 'errors.NotReadableError', 'NetworkError': 'errors.NetworkError', 'AbortError': 'errors.AbortError', 'TimeoutError': 'errors.WriteTimeoutError' }; if (error.name === 'NetworkError' && generateUrlFromForm().length > CONFIG.MAX_PAYLOAD_SIZE) { return t('messages.payloadTooLarge'); } if (errorMap[error.name]) { return t(errorMap[error.name]); } return error.message || t('errors.unknown'); } }

    // --- App Initialization ---
    async function loadConfig() { try { const response = await fetch('/ThiXX/config.json'); if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); return await response.json(); } catch (error) { console.warn('Config load failed, using default.', error); return { design: "default" }; } }
    
    async function main() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/ThiXX/sw.js', { scope: '/ThiXX/' })
                    .then(registration => {
                        console.log('Service Worker registered:', registration.scope);
                        registration.addEventListener('updatefound', () => {
                            const newWorker = registration.installing;
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    updateBanner.classList.remove('hidden');
                                }
                            });
                        });
                    })
                    .catch(err => ErrorHandler.handle(err, 'ServiceWorkerRegistration'));
                
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                     window.location.reload();
                });
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
        
        // [MODIFIZIERT] processUrlParameters() wird ohne Parameter aufgerufen,
        // um den passiven Android-Scan (über window.location.search) zu verarbeiten.
        if (!processUrlParameters()) {
            setupReadTabInitialState();
            switchTab('read-tab');
            if (readResultContainer) {
                autoExpandToFitScreen(readResultContainer);
                readResultContainer.classList.add('expanded');
                readResultContainer.style.maxHeight = '';
            }
        }
    }
    main();

    // --- Event Handler Definitions for robust add/remove ---
    const handleTabClick = (e) => { const tabLink = e.target.closest('.tab-link'); if (tabLink) switchTab(tabLink.dataset.tab); };
    const handleThemeChange = (e) => { const themeBtn = e.target.closest('.theme-btn'); if (themeBtn) applyTheme(themeBtn.dataset.theme); };
    const handleReloadClick = () => { navigator.serviceWorker.getRegistration().then(reg => { if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } }); };
    const handlePt100Change = (e) => { const el = document.getElementById('PT 100'); if (el) el.disabled = !e.target.checked; };
    const handleNiCrNiChange = (e) => { const el = document.getElementById('NiCr-Ni'); if (el) el.disabled = !e.target.checked; };
    const debouncedUpdatePayload = debounce(updatePayloadOnChange, CONFIG.DEBOUNCE_DELAY);
    const handleCheckForUpdate = () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg) {
                    reg.update().then(newReg => {
                        if (newReg.installing) {
                            showMessage(t('messages.updateChecking'), 'info');
                        } else if (newReg.waiting) {
                            updateBanner.classList.remove('hidden');
                        } else {
                            showMessage(t('messages.noUpdateFound'), 'ok');
                        }
                    });
                }
            });
        }
    };

    function setupEventListeners() {
        if(tabsContainer) tabsContainer.addEventListener('click', handleTabClick);
        if(themeSwitcher) themeSwitcher.addEventListener('click', handleThemeChange);
        if(nfcStatusBadge) nfcStatusBadge.addEventListener('click', handleNfcAction);
        if(checkForUpdateBtn) checkForUpdateBtn.addEventListener('click', handleCheckForUpdate);
        
        if (!isIOS()) {
            if (copyToFormBtn) {
                copyToFormBtn.addEventListener('click', populateFormFromScan);
            }
            if(saveJsonBtn) saveJsonBtn.addEventListener('click', saveFormAsJson);
            if(loadJsonInput) loadJsonInput.addEventListener('change', loadJsonIntoForm);
            if (loadJsonLabel && loadJsonInput) {
                loadJsonLabel.addEventListener('click', () => { 
                    loadJsonInput.click(); 
                });
            }
        }
        
        if(form) {
            form.addEventListener('input', debouncedUpdatePayload);
            form.addEventListener('change', updatePayloadOnChange);
        }
        if(reloadButton) reloadButton.addEventListener('click', handleReloadClick);
        const pt100Checkbox = document.getElementById('has_PT100');
        if(pt100Checkbox) pt100Checkbox.addEventListener('change', handlePt100Change);
        const niCrNiCheckbox = document.getElementById('has_NiCr-Ni');
        if(niCrNiCheckbox) niCrNiCheckbox.addEventListener('change', handleNiCrNiChange);
    }

    function cleanupEventListeners() {
        // ... (unverändert) ...
    }

    // --- UI & Display Logic ---
    function createDataPair(label, value, unit = '') { if (value === undefined || value === null || String(value).trim() === '') return null; const div = document.createElement('div'); div.className = 'data-pair'; const labelSpan = document.createElement('span'); labelSpan.className = 'data-pair-label'; labelSpan.textContent = label; const valueSpan = document.createElement('span'); valueSpan.className = 'data-pair-value'; valueSpan.textContent = `${value} ${unit}`.trim(); div.appendChild(labelSpan); div.appendChild(valueSpan); return div; }
    async function displayParsedData(data) { protocolCard.innerHTML = ''; const fragments = { main: document.createDocumentFragment(), section1: document.createDocumentFragment(), section2: document.createDocumentFragment(), section3: document.createDocumentFragment(), footer: document.createDocumentFragment() }; const addPair = (frag, labelKey, val, unit) => { const el = createDataPair(t(labelKey), val, unit); if (el) frag.appendChild(el); }; addPair(fragments.main, 'HK-Nr', data['HK-Nr']); addPair(fragments.main, 'KKS', data['KKS']); addPair(fragments.section1, 'Leistung', data['Leistung'], 'kW'); addPair(fragments.section1, 'Strom', data['Strom'], 'A'); addPair(fragments.section1, 'Spannung', data['Spannung'], 'V'); addPair(fragments.section1, 'Widerstand', data['Widerstand'], 'Ω'); addPair(fragments.section2, 'Anzahl Heizkabeleinheiten', data['Anzahl Heizkabeleinheiten'], 'Stk'); addPair(fragments.section2, 'Trennkasten', data['Trennkasten'], 'Stk'); addPair(fragments.section2, 'Heizkabeltyp', data['Heizkabeltyp']); addPair(fragments.section2, 'Schaltung', data['Schaltung']); if (data['PT 100']) addPair(fragments.section2, 'Messwertgeber', `PT 100: ${data['PT 100']}`, 'Stk'); if (data['NiCr-Ni']) addPair(fragments.section2, 'Messwertgeber', `NiCr-Ni: ${data['NiCr-Ni']}`, 'Stk'); addPair(fragments.section3, 'Regler', data['Regler'], '°C'); addPair(fragments.section3, 'Sicherheitsregler/Begrenzer', data['Sicherheitsregler/Begrenzer'], '°C'); addPair(fragments.section3, 'Wächter', data['Wächter'], '°C'); addPair(fragments.footer, 'Projekt-Nr', data['Projekt-Nr']); addPair(fragments.footer, 'geprüft von', data['geprüft von']); addPair(fragments.footer, 'am', data['am']); const createSection = (frag, className) => { if (frag.hasChildNodes()) { const section = document.createElement('div'); section.className = className; section.appendChild(frag); protocolCard.appendChild(section); } }; createSection(fragments.main, 'card-main'); createSection(fragments.section1, 'card-section'); createSection(fragments.section2, 'card-section'); createSection(fragments.section3, 'card-section'); createSection(fragments.footer, 'card-footer'); docLinkContainer.innerHTML = ''; if (data['Dokumentation']) { const url = data['Dokumentation']; if (!isValidDocUrl(url)) { console.warn('Invalid documentation URL provided:', url); return; } const button = document.createElement('button'); button.className = 'btn doc-link-btn'; button.dataset.url = url; const isCached = await isUrlCached(url); if (isCached) { button.textContent = t('docOpenOffline'); button.onclick = () => window.open(url, '_blank'); } else { button.textContent = navigator.onLine ? t('docDownload') : t('docDownloadLater'); button.addEventListener('click', handleDocButtonClick); } docLinkContainer.appendChild(button); } }

    function applyConfig(config) {
        // ... (unverändert) ...
    }

    // --- NFC Logic ---
    
    /**
     * [MODIFIZIERT FÜR iOS]
     * Diese Funktion löst jetzt entweder einen Lese- oder einen Schreibvorgang aus.
     * - Auf iOS: Startet *immer* einen Lese-Scan.
     * - Auf Android: Startet einen Lese-Scan (im "Lesen"-Tab) oder einen Schreib-Vorgang (im "Schreiben"-Tab).
     */
    async function handleNfcAction() {
        if (appState.isNfcActionActive || appState.isCooldownActive) return;

        const writeTab = document.getElementById('write-tab');
        // Schreibmodus ist nur aktiv, wenn NICHT iOS UND der "Schreiben"-Tab aktiv ist.
        const isWriteMode = !isIOS() && writeTab?.classList.contains('active');

        appState.isNfcActionActive = true;
        appState.abortController = new AbortController();
        appState.nfcTimeoutId = setTimeout(() => {
            if (appState.abortController && !appState.abortController.signal.aborted) {
                const errorMsg = isWriteMode ? 'Write operation timed out.' : 'Scan operation timed out.';
                appState.abortController.abort(new DOMException(errorMsg, 'TimeoutError'));
            }
        }, CONFIG.NFC_WRITE_TIMEOUT);

        try {
            const ndef = new NDEFReader();

            if (isWriteMode) {
                // --- SCHREIB-LOGIK (Nur Android) ---
                const validationErrors = validateForm();
                if (validationErrors.length > 0) {
                    throw new Error(validationErrors.join('\n'));
                }
                setNfcBadge('writing');
                const urlPayload = generateUrlFromForm();
                const message = { records: [{ recordType: "url", data: urlPayload }] };
                await writeWithRetries(ndef, message);

            } else {
                // --- LESE-LOGIK (iOS oder Android im "Lesen"-Tab) ---
                setNfcBadge('scanning');
                showMessage(t('status.scanning'), 'info', CONFIG.NFC_WRITE_TIMEOUT + 1000); // Nachricht etwas länger anzeigen

                ndef.addEventListener('readingerror', () => {
                    ErrorHandler.handle(new Error(t('errors.NotReadableError')), 'NFCScan');
                });

                ndef.addEventListener('reading', ({ message }) => {
                    clearTimeout(appState.nfcTimeoutId);
                    
                    const record = message.records[0];
                    if (record && record.recordType === "url") {
                        const url = new URL(record.data);
                        // Verarbeite die gelesenen URL-Parameter
                        if (processUrlParameters(url.searchParams)) {
                            setNfcBadge('success', t('messages.readSuccess'));
                            showMessage(t('messages.readSuccess'), 'ok');
                        } else {
                            // URL war ungültig oder enthielt keine Daten
                            setupReadTabInitialState();
                            ErrorHandler.handle(new Error("Ungültiger Tag-Inhalt."), 'NFCScan');
                        }
                    } else {
                         ErrorHandler.handle(new Error("Keine URL auf Tag gefunden."), 'NFCScan');
                    }
                    
                    abortNfcAction(); // Scan beenden
                    startCooldown();
                });

                // Scan starten
                await ndef.scan({ signal: appState.abortController.signal });
            }

        } catch (error) {
            clearTimeout(appState.nfcTimeoutId);
            if (error.name !== 'AbortError') {
                ErrorHandler.handle(error, 'NFCAction');
            } else if (error.message.includes('timed out')) {
                 const timeoutError = new DOMException(error.message, 'TimeoutError');
                 ErrorHandler.handle(timeoutError, 'NFCAction');
            }
            abortNfcAction();
            startCooldown();
        }
    }

    async function writeWithRetries(ndef, message) {
        // ... (unverändert) ...
    }

    // --- Data Processing & Form Handling ---

    /**
     * [MODIFIZIERT FÜR iOS]
     * Akzeptiert optional ein 'paramsOverride'-Objekt.
     * - Wenn 'paramsOverride' vorhanden ist (vom iOS-Scan), werden diese Daten verarbeitet.
     * - Wenn nicht (Standard), werden die Daten aus 'window.location.search' (vom Android-Scan) verarbeitet.
     */
    function processUrlParameters(paramsOverride = null) {
        // Override (iOS-Scan) oder window.location (Android-Scan) verwenden
        const params = paramsOverride || new URLSearchParams(window.location.search);
        const isFromWindowLocation = !paramsOverride;

        if (params.toString() === '') return false;

        const data = {};
        for (const [shortKey, value] of params.entries()) {
            const fullKey = reverseFieldMap[shortKey];
            if (fullKey) data[fullKey] = decodeURIComponent(value);
        }

        if (Object.keys(data).length > 0) {
            appState.scannedDataObject = data;
            displayParsedData(data);
            
            // Rohdaten-URL anzeigen
            const rawUrl = isFromWindowLocation ? window.location.href : (CONFIG.BASE_URL + "?" + params.toString());
            if(rawDataOutput) rawDataOutput.value = rawUrl;
            
            if(readActions) readActions.classList.remove('hidden');
            
            // Zum Lese-Tab wechseln (wichtig für iOS-Scan)
            switchTab('read-tab'); 

            if (readResultContainer) {
                readResultContainer.classList.remove('expanded');
                autoExpandToFitScreen(readResultContainer);
            }

            // Nur die URL-Leiste bereinigen, wenn die Daten von dort kamen
            if (isFromWindowLocation) {
                showMessage(t('messages.readSuccess'), 'ok');
                history.replaceState(null, '', window.location.pathname);
            }
            return true;
        }

        return false;
    }

    function getFormData() {
        // ... (unverändert) ...
    }

    function generateUrlFromForm() { 
        // ... (unverändert) ...
    }
    function updatePayloadOnChange() { 
        // ... (unverändert) ...
    }
    function validateForm() { 
        // ... (unverändert) ...
    }

    // --- Helper & State Functions ---
    function startCooldown() { 
        // ... (unverändert) ...
    }
    function abortNfcAction() { 
        // ... (unverändert) ...
    }
    function addLogEntry(message, type = 'info') { 
        // ... (unverändert) ...
    }
    function renderLog() { 
        // ... (unverändert) ...
    }

    // --- Service Worker & Cache ---
    async function isUrlCached(url) { 
        // ... (unverändert) ...
    }
    async function handleDocButtonClick(event) { 
        // ... (unverändert) ...
    }

    // --- UI/UX Functions ---
    function updateManifest(design) { 
        // ... (unverändert) ...
    }
    function applyTheme(themeName) { 
        // ... (unverändert) ...
    }
    function setupReadTabInitialState() { 
        // ... (unverändert) ...
    }
    function initCollapsibles() { 
        // ... (unverändert) ...
    }
    
    /**
     * [MODIFIZIERT FÜR iOS]
     * Stellt sicher, dass auf iOS der "Schreiben"-Tab ausgeblendet wird,
     * aber der NFC-Button für das Lesen *aktiviert* bleibt.
     */
    function checkNfcSupport() {
        const writeTabLink = document.querySelector('.tab-link[data-tab="write-tab"]');

        if ('NDEFReader' in window) {
            // NFC wird generell unterstützt
            setNfcBadge('idle');

            if (isIOS()) {
                // iOS: Nur Lesen unterstützen
                if(tabsContainer) tabsContainer.classList.remove('hidden'); // Tabs anzeigen
                if(copyToFormBtn) copyToFormBtn.classList.add('hidden'); // Kopieren-Button ausblenden
                if (writeTabLink) writeTabLink.style.display = 'none'; // Schreiben-Tab ausblenden
                
                // WICHTIG: Sicherstellen, dass der Badge für das Lesen aktiviert ist
                if(nfcStatusBadge) {
                    nfcStatusBadge.disabled = false;
                    setNfcBadge('idle'); // Setzt den korrekten iOS-Text
                }
            }
            // Android: Volle Unterstützung, nichts weiter tun.

        } else {
            // NFC wird überhaupt nicht unterstützt (z.B. alter Browser)
            setNfcBadge('unsupported');
            if(nfcFallback) nfcFallback.classList.remove('hidden');
            if(nfcStatusBadge) nfcStatusBadge.disabled = true;
            if (writeTabLink) writeTabLink.style.display = 'none';
        }
    }

    function switchTab(tabId) { 
        // [MODIFIZIERT] Abbruch-Logik leicht angepasst
        if (appState.isNfcActionActive && tabId !== 'read-tab') {
             abortNfcAction(); 
        }
        
        document.querySelectorAll('.tab-link').forEach(tab => tab.classList.remove('active')); 
        tabContents.forEach(content => content.classList.remove('active')); 
        const activeTabLink = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
        if(activeTabLink) activeTabLink.classList.add('active');
        const activeTabContent = document.getElementById(tabId);
        if(activeTabContent) activeTabContent.classList.add('active');
        
        if (legalInfoContainer) { 
            legalInfoContainer.classList.toggle('hidden', tabId !== 'read-tab'); 
        } 
        
        if ('NDEFReader' in window) {
            setNfcBadge('idle');
        }
        
        if (tabId === 'write-tab') {
            updatePayloadOnChange();
            const writeFormContainer = document.getElementById('write-form-container');
            if (writeFormContainer) {
                writeFormContainer.classList.remove('expanded');
                autoExpandToFitScreen(writeFormContainer);
            }
        } else if (tabId === 'read-tab') {
            if (readResultContainer) {
                if (appState.scannedDataObject) {
                    readResultContainer.classList.remove('expanded');
                    autoExpandToFitScreen(readResultContainer);
                } else {
                    readResultContainer.classList.add('expanded');
                    readResultContainer.style.maxHeight = '';
                }
            }
        }
    }

    function showMessage(text, type = 'info', duration = 4000) { 
        // ... (unverändert) ...
    }
    function setTodaysDate() { 
        // ... (unverändert) ...
    }
    
    function setNfcBadge(state, message = '') {
        if(!nfcStatusBadge) return;
        
        // [MODIFIZIERT] Logik für isWriteMode berücksichtigt iOS
        const writeTab = document.getElementById('write-tab');
        const isWriteMode = !isIOS() && writeTab?.classList.contains('active');

        if (isIOS()) {
            // Spezielle iOS-Logik: Zeigt immer den Lese-Status an
            const iosStates = {
                idle: [t('status.iosRead'), 'info'],
                scanning: [t('status.scanning'), 'info'],
                success: [message || t('status.success'), 'ok'],
                error: [message || t('status.error'), 'err'],
                cooldown: [t('status.cooldown'), 'info']
            };
            const [text, className] = iosStates[state] || iosStates['idle'];
            nfcStatusBadge.textContent = text; 
            nfcStatusBadge.className = 'nfc-badge'; 
            nfcStatusBadge.classList.add(className);
            return;
        }

        // Standard Android / Desktop Logik
        const states = { 
            unsupported: [t('status.unsupported'), 'err'], 
            idle: [isWriteMode ? t('status.startWriting') : t('status.startReading'), 'info'],
            scanning: [t('status.scanning'), 'info'], 
            writing: [t('status.writing'), 'info'], 
            success: [message || t('status.success'), 'ok'], 
            error: [message || t('status.error'), 'err'], 
            cooldown: [t('status.cooldown'), 'info']
        }; 
        const [text, className] = states[state] || states['idle']; 
        nfcStatusBadge.textContent = text; 
        nfcStatusBadge.className = 'nfc-badge'; 
        nfcStatusBadge.classList.add(className);
    }
    
    function populateFormFromScan() {
        if (isIOS()) {
            showMessage(t('messages.noDataToCopy'), 'err');
            return;
        }

        if (!appState.scannedDataObject) { 
            showMessage(t('messages.noDataToCopy'), 'err'); 
            return;
        }
        
        // ... (Rest der Funktion unverändert) ...
        if(form) form.reset(); 
        setTodaysDate(); 

        for (const [key, value] of Object.entries(appState.scannedDataObject)) { 
            if(!form) continue;
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
        if (appState.scannedDataObject['PT 100']) {
            if (pt100Input) {
                pt100Input.value = appState.scannedDataObject['PT 100'];
                pt100Input.disabled = false;
            }
            if (hasPt100Checkbox) hasPt100Checkbox.checked = true;
        } else {
            if (pt100Input) pt100Input.disabled = true;
            if (hasPt100Checkbox) hasPt100Checkbox.checked = false;
        }

        const niCrInput = document.getElementById('NiCr-Ni'); 
        const hasNiCrCheckbox = document.getElementById('has_NiCr-Ni'); 
        if (appState.scannedDataObject['NiCr-Ni']) {
            if (niCrInput) {
                niCrInput.disabled = false;
                niCrInput.value = appState.scannedDataObject['NiCr-Ni'];
            }
            if (hasNiCrCheckbox) hasNiCrCheckbox.checked = true;
        } else {
            if (niCrInput) niCrInput.disabled = true;
            if (hasNiCrCheckbox) hasNiCrCheckbox.checked = false;
        }

        switchTab('write-tab'); 
        showMessage(t('messages.copySuccess'), 'ok');
    }
    function saveFormAsJson() { 
        // ... (unverändert) ...
    }
    function loadJsonIntoForm(event) { 
        // ... (unverändert) ...
    }
    
    function autoExpandToFitScreen(elementToExpand) {
        // ... (unverändert) ...
    }

    function makeCollapsible(el) {
        // ... (unverändert) ...
    }
});

