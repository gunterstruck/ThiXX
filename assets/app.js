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
    const debounce = (func, wait) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; };
    function isValidDocUrl(url) { if (!url) return false; try { const p = new URL(url); return p.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(p.hostname); } catch { return false; } }

    // --- Internationalization (i18n) ---
    function t(key, opt = {}) { let txt = key.split('.').reduce((o, i) => o?.[i], appState.translations) || key; if (opt.replace) { Object.entries(opt.replace).forEach(([p, v]) => { txt = txt.replace(`{${p}}`, v); }); } return txt; }
    async function loadTranslations() {
        const lang = navigator.language.split('-')[0];
        const supported = ['de', 'en', 'es', 'fr'];
        const selLang = supported.includes(lang) ? lang : 'de';
        try {
            const res = await fetch(`lang/${selLang}.json`);
            if (!res.ok) throw new Error('File not found');
            appState.translations = await res.json();
            document.documentElement.lang = selLang;
        } catch (e) { console.error('Translation failed', e); const fb = await fetch('lang/de.json'); appState.translations = await fb.json(); document.documentElement.lang = 'de'; }
    }
    function applyTranslations() { document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); }); document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); }); document.title = t('appTitle'); }

    // --- Error Handling ---
    class ErrorHandler {
        static handle(e, ctx = 'General') { const msg = this.getReadableError(e); console.error(`[${ctx}]`, e); showMessage(msg, 'err'); addLogEntry(`${ctx}: ${msg}`, 'err'); }
        static getReadableError(e) { const map = { 'NotAllowedError': 'errors.NotAllowedError', 'NotSupportedError': 'errors.NotSupportedError', 'NotFoundError': 'errors.NotFoundError', 'NotReadableError': 'errors.NotReadableError', 'NetworkError': 'errors.NetworkError', 'AbortError': 'errors.AbortError', 'TimeoutError': 'errors.WriteTimeoutError' }; if (e.name === 'NetworkError' && generateUrlFromForm().length > CONFIG.MAX_PAYLOAD_SIZE) { return t('messages.payloadTooLarge'); } return t(map[e.name] || 'errors.unknown'); }
    }

    // --- App Initialization ---
    async function loadConfig() { try { const res = await fetch('config.json'); if (!res.ok) throw new Error(); return await res.json(); } catch { return { design: "default" }; } }
    async function main() {
        if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => console.log('SW reg:', reg.scope)).catch(e => ErrorHandler.handle(e, 'SWReg')); }); }
        await loadTranslations(); applyTranslations();
        const config = await loadConfig(); applyConfig(config);
        setupEventListeners(); setTodaysDate(); checkNfcSupportAndSetupUI(); initCollapsibles();
        if (!processUrlParameters()) { setupReadTabInitialState(); }
    }
    main();

    function setupEventListeners() {
        tabsContainer.addEventListener('click', e => { const el = e.target.closest('.tab-link'); if (el) switchTab(el.dataset.tab); });
        themeSwitcher.addEventListener('click', e => { const el = e.target.closest('.theme-btn'); if (el) applyTheme(el.dataset.theme); });
        nfcStatusBadge.addEventListener('click', handleNfcAction);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonLabel?.addEventListener('click', () => loadJsonInput.click());
        loadJsonInput.addEventListener('change', loadJsonIntoForm);
        form.addEventListener('input', debounce(updatePayloadOnChange, CONFIG.DEBOUNCE_DELAY));
        form.addEventListener('change', updatePayloadOnChange);
        document.getElementById('has_pt100')?.addEventListener('change', e => { document.getElementById('pt100').disabled = !e.target.checked; });
        document.getElementById('has_nicr_ni')?.addEventListener('change', e => { document.getElementById('nicr_ni').disabled = !e.target.checked; });
    }

    // --- UI & Display ---
    async function displayParsedData(data) {
        protocolCard.innerHTML = '';
        const originalKeys = { 'hk_nr': 'HK.Nr.', 'kks': 'KKS', 'leistung': 'Leistung', 'strom': 'Strom', 'spannung': 'Spannung', 'widerstand': 'Widerstand', 'regler': 'Regler', 'sicherheitsregler_begrenzer': 'Sicherheitsregler/Begrenzer', 'waechter': 'Wächter', 'projekt_nr': 'Projekt Nr.', 'dokumentation': 'Dokumentation', 'anzahl_heizkabeleinheiten': 'Anzahl Heizkabeleinheiten', 'trennkasten': 'Trennkasten', 'heizkabeltyp': 'Heizkabeltyp', 'schaltung': 'Schaltung', 'pt100': 'PT 100', 'nicr_ni': 'NiCr-Ni', 'geprueft_von': 'geprüft von', 'am': 'am' };
        const frags = { m: document.createDocumentFragment(), s1: document.createDocumentFragment(), s2: document.createDocumentFragment(), s3: document.createDocumentFragment(), f: document.createDocumentFragment() };
        const add = (frag, key, val, unit) => { if (val !== undefined && val !== null && String(val).trim() !== '') { const div = document.createElement('div'); div.className = 'data-pair'; div.innerHTML = `<span class="data-pair-label">${t(`form.${originalKeys[key]}`)}</span><span class="data-pair-value">${String(val).trim()} ${unit || ''}</span>`; frag.appendChild(div); } };
        add(frags.m, 'hk_nr', data.hk_nr); add(frags.m, 'kks', data.kks);
        add(frags.s1, 'leistung', data.leistung, 'kW'); add(frags.s1, 'strom', data.strom, 'A'); add(frags.s1, 'spannung', data.spannung, 'V'); add(frags.s1, 'widerstand', data.widerstand, 'Ω');
        add(frags.s2, 'anzahl_heizkabeleinheiten', data.anzahl_heizkabeleinheiten, 'Stk'); add(frags.s2, 'trennkasten', data.trennkasten, 'Stk'); add(frags.s2, 'heizkabeltyp', data.heizkabeltyp); add(frags.s2, 'schaltung', data.schaltung); add(frags.s2, 'pt100', data.pt100, 'Stk'); add(frags.s2, 'nicr_ni', data.nicr_ni, 'Stk');
        add(frags.s3, 'regler', data.regler, '°C'); add(frags.s3, 'sicherheitsregler_begrenzer', data.sicherheitsregler_begrenzer, '°C'); add(frags.s3, 'waechter', data.waechter, '°C');
        add(frags.f, 'projekt_nr', data.projekt_nr); add(frags.f, 'geprueft_von', data.geprueft_von); add(frags.f, 'am', data.am);
        const sec = (frag, cls) => { if (frag.hasChildNodes()) { const el = document.createElement('div'); el.className = cls; el.appendChild(frag); protocolCard.appendChild(el); } };
        sec(frags.m, 'card-main'); sec(frags.s1, 'card-section'); sec(frags.s2, 'card-section'); sec(frags.s3, 'card-section'); sec(frags.f, 'card-footer');
        docLinkContainer.innerHTML = '';
        if (data.dokumentation && isValidDocUrl(data.dokumentation)) {
            const btn = document.createElement('button'); btn.type = "button"; btn.className = 'btn doc-link-btn'; btn.dataset.url = data.dokumentation;
            btn.textContent = await isUrlCached(data.dokumentation) ? t('docOpenOffline') : (navigator.onLine ? t('docDownload') : t('docDownloadLater'));
            btn.addEventListener('click', handleDocButtonClick); docLinkContainer.appendChild(btn);
        }
    }
    function applyConfig(config) { const design = designs[config.design] || designs['thixx_standard']; updateManifest(design); applyTheme(design.theme); if (themeSwitcher) themeSwitcher.classList.toggle('hidden', design.lockTheme); const custImg = document.querySelector('.theme-btn[data-theme="customer-brand"] img'); if (custImg && design.icons?.icon512) custImg.src = design.icons.icon512; const appleIcon = document.querySelector('link[rel="apple-touch-icon"]'); if (appleIcon && design.icons?.icon192) appleIcon.href = design.icons.icon192; if (design.brandColors?.primary) document.documentElement.style.setProperty('--primary-color-override', design.brandColors.primary); if (design.brandColors?.secondary) document.documentElement.style.setProperty('--secondary-color-override', design.brandColors.secondary); }

    // --- NFC Logic ---
    async function handleNfcAction() {
        if (appState.isNfcActionActive || appState.isCooldownActive) return; appState.isNfcActionActive = true; appState.abortController = new AbortController(); const isWrite = document.querySelector('.tab-link[data-tab="write-tab"].active'); appState.nfcTimeoutId = setTimeout(() => appState.abortController?.abort(new DOMException('NFC Timed Out', 'TimeoutError')), CONFIG.NFC_WRITE_TIMEOUT);
        try {
            const ndef = new NDEFReader();
            if (isWrite) { const errs = validateForm(); if (errs.length > 0) throw new Error(errs.join('\n')); setNfcBadge('writing'); const url = generateUrlFromForm(); await writeWithRetries(ndef, { records: [{ recordType: "url", data: url }] }); }
            else { setNfcBadge('scanning'); showMessage(t('messages.readPrompt'), 'info'); ndef.onreading = evt => { clearTimeout(appState.nfcTimeoutId); try { const rec = evt.message.records.find(r => r.recordType === 'url'); if (rec) { const url = new TextDecoder().decode(rec.data); if (url.startsWith(CONFIG.BASE_URL)) window.location.href = url; else throw new Error(t('messages.noKnownContent')); } else { if(evt.message.records.length === 0) throw new Error(t('errors.tagEmpty')); throw new Error(t('messages.noKnownContent')); } } catch (e) { ErrorHandler.handle(e, 'NFCReadCb'); } finally { abortNfcAction(); startCooldown(); } }; await ndef.scan({ signal: appState.abortController.signal }); }
        } catch (e) { clearTimeout(appState.nfcTimeoutId); if (e.name !== 'AbortError') ErrorHandler.handle(e, 'NFCAction'); else if (e.message.includes('Timed Out')) ErrorHandler.handle(new DOMException('Write timed out.', 'TimeoutError'), 'NFCAction'); abortNfcAction(); startCooldown(); }
    }
    async function writeWithRetries(ndef, msg) { for (let i = 1; i <= CONFIG.MAX_WRITE_RETRIES; i++) { try { showMessage(t('messages.writeAttempt', { replace: { attempt: i, total: CONFIG.MAX_WRITE_RETRIES } }), 'info', CONFIG.NFC_WRITE_TIMEOUT); await ndef.write(msg, { signal: appState.abortController.signal }); clearTimeout(appState.nfcTimeoutId); setNfcBadge('success', t('status.tagWritten')); showMessage(t('messages.writeSuccess'), 'ok'); appState.gracePeriodTimeoutId = setTimeout(() => { if (appState.gracePeriodTimeoutId !== null) { abortNfcAction(); startCooldown(); } }, CONFIG.WRITE_SUCCESS_GRACE_PERIOD); ndef.onreading = () => {}; ndef.scan({ signal: appState.abortController.signal }).catch(() => {}); return; } catch (e) { console.warn(`Write attempt ${i} failed:`, e); if (i === CONFIG.MAX_WRITE_RETRIES || ['TimeoutError', 'AbortError'].includes(e.name)) throw e; await new Promise(r => setTimeout(r, 200)); } } }

    // --- Data & Form Handling ---
    function processUrlParameters() { const p = new URLSearchParams(window.location.search); if (!p.toString()) return false; const data = {}; for (const [k, v] of p.entries()) { const key = reverseFieldMap[k]; if (key) data[key] = v; } if (Object.keys(data).length > 0) { appState.scannedDataObject = data; displayParsedData(data); rawDataOutput.value = window.location.href; readActions.classList.remove('hidden'); readResultContainer.classList.add('expanded'); switchTab('read-tab'); return true; } return false; }
    function getFormData() { const data = {}; const fd = new FormData(form); for (const [k, v] of fd.entries()) { if (String(v).trim()) data[k] = String(v).trim(); } if (!document.getElementById('has_pt100')?.checked) delete data.pt100; if (!document.getElementById('has_nicr_ni')?.checked) delete data.nicr_ni; delete data.has_pt100; delete data.has_nicr_ni; return data; }
    function generateUrlFromForm() { const p = new URLSearchParams(); const data = getFormData(); for (const [k, v] of Object.entries(data)) { const sk = fieldMap[k]; if (sk) p.append(sk, v); } return `${CONFIG.BASE_URL}?${p.toString()}`; }
    function updatePayloadOnChange() { if (document.querySelector('.tab-link[data-tab="write-tab"].active')) { const url = generateUrlFromForm(); payloadOutput.value = url; const bytes = new TextEncoder().encode(url).length; payloadSize.textContent = `${bytes} / ${CONFIG.MAX_PAYLOAD_SIZE} Bytes`; const over = bytes > CONFIG.MAX_PAYLOAD_SIZE; payloadSize.classList.toggle('limit-exceeded', over); nfcStatusBadge.disabled = over; } }
    function validateForm() { const errs = []; const v = form.elements.spannung?.value; if (v && (v < 0 || v > 1000)) errs.push(t('errors.invalidVoltage')); const url = form.elements.dokumentation?.value; if (url && !isValidDocUrl(url)) errs.push(t('errors.invalidDocUrl')); if (generateUrlFromForm().length > CONFIG.MAX_PAYLOAD_SIZE) errs.push(t('messages.payloadTooLarge')); return errs; }

    // --- State & Helpers ---
    function startCooldown() { appState.isCooldownActive = true; setNfcBadge('cooldown'); setTimeout(() => { appState.isCooldownActive = false; if ('NDEFReader' in window) setNfcBadge('idle'); }, CONFIG.COOLDOWN_DURATION); }
    function abortNfcAction() { clearTimeout(appState.nfcTimeoutId); if (appState.gracePeriodTimeoutId) clearTimeout(appState.gracePeriodTimeoutId); appState.gracePeriodTimeoutId = null; appState.abortController?.abort(new DOMException('User aborted', 'AbortError')); appState.abortController = null; appState.isNfcActionActive = false; }

    // --- SW & Cache ---
    async function isUrlCached(url) { if (!('caches' in window)) return false; try { const cache = await caches.open('thixx-docs-v1'); const res = await cache.match(new Request(url, { mode: 'no-cors' })); return !!res; } catch { return false; } }
    async function handleDocButtonClick(e) { const btn = e.target; const url = btn.dataset.url; if (navigator.onLine) { window.open(url, '_blank'); btn.textContent = t('docOpenOffline'); btn.onclick = () => window.open(url, '_blank'); navigator.serviceWorker.controller?.postMessage({ action: 'cache-doc', url: url }); } else { showMessage(t('docDownloadLater'), 'info'); } }

    // --- UI/UX ---
    function switchTab(id) { abortNfcAction(); document.querySelectorAll('.tab-link').forEach(t => t.classList.remove('active')); document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.querySelector(`.tab-link[data-tab="${id}"]`)?.classList.add('active'); document.getElementById(id)?.classList.add('active'); legalInfoContainer?.classList.toggle('hidden', id !== 'read-tab'); if ('NDEFReader' in window) setNfcBadge('idle'); if (id === 'write-tab') updatePayloadOnChange(); requestAnimationFrame(() => { const el = document.querySelector(id === 'write-tab' ? '#nfc-write-form input, #nfc-write-form select' : '#read-actions button'); el?.focus(); }); }
    function checkNfcSupportAndSetupUI() { if ('NDEFReader' in window) { setNfcBadge('idle'); } else { setNfcBadge('unsupported'); nfcFallback?.classList.remove('hidden'); if (nfcStatusBadge) nfcStatusBadge.disabled = true; if (writeTabButton) writeTabButton.classList.add('hidden'); } }
    function showMessage(txt, type = 'info', dur = 4000) { messageBanner.textContent = txt; messageBanner.className = `message-banner ${type}`; messageBanner.classList.remove('hidden'); setTimeout(() => messageBanner.classList.add('hidden'), dur); addLogEntry(txt, type); }
    function setTodaysDate() { const today = new Date().toISOString().split('T')[0]; const el = document.getElementById('am'); if (el) el.value = today; }
    function setNfcBadge(state, msg = '') { const isWrite = document.querySelector('.tab-link[data-tab="write-tab"].active'); const states = { unsupported: [t('status.unsupported'), 'err'], idle: [isWrite ? t('status.startWriting') : t('status.startReading'), 'info'], scanning: [t('status.scanning'), 'info'], writing: [t('status.writing'), 'info'], success: [msg || t('status.success'), 'ok'], error: [msg || t('status.error'), 'err'], cooldown: [t('status.cooldown'), 'info'] }; const [txt, cls] = states[state] || states.idle; nfcStatusBadge.textContent = txt; nfcStatusBadge.className = `nfc-badge ${cls}`; }
    function populateFormFromScan() { if (!appState.scannedDataObject) { showMessage(t('messages.noDataToCopy'), 'err'); return; } form.reset(); setTodaysDate(); Object.entries(appState.scannedDataObject).forEach(([k, v]) => { const el = form.elements[k]; if (el) { if (el.type === 'radio') { form.querySelector(`input[name="${k}"][value="${v}"]`)?.setAttribute('checked', true); } else if (el.type === 'checkbox') { el.checked = (v === 'true' || v === 'on'); } else { el.value = v; } } }); ['pt100', 'nicr_ni'].forEach(id => { const hasCb = document.getElementById(`has_${id}`); const numIn = document.getElementById(id); if (numIn && hasCb) { const hasVal = appState.scannedDataObject[id]; hasCb.checked = !!hasVal; numIn.disabled = !hasVal; if (hasVal) numIn.value = hasVal; } }); switchTab('write-tab'); document.getElementById('write-form-container').classList.add('expanded'); showMessage(t('messages.copySuccess'), 'ok'); }
    function saveFormAsJson() { const data = getFormData(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `thixx-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 100); showMessage(t('messages.saveSuccess'), 'ok'); }
    function loadJsonIntoForm(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = evt => { try { appState.scannedDataObject = JSON.parse(evt.target.result); populateFormFromScan(); showMessage(t('messages.loadSuccess'), 'ok'); } catch (err) { ErrorHandler.handle(err, 'LoadJSON'); } finally { e.target.value = null; } }; r.readAsText(f); }
    function addLogEntry(msg, type = 'info') { const ts = new Date().toLocaleTimeString(); appState.eventLog.unshift({ ts, msg, type }); if (appState.eventLog.length > CONFIG.MAX_LOG_ENTRIES) appState.eventLog.pop(); renderLog(); }
    function renderLog() { if (!eventLogOutput) return; eventLogOutput.innerHTML = appState.eventLog.map(e => `<div class="log-entry ${e.type}"><span class="log-timestamp">${e.ts}</span> ${e.msg}</div>`).join(''); }
    function makeCollapsible(el) { if (!el || el.dataset.collapsibleApplied) return; el.dataset.collapsibleApplied = 'true'; const tgl = () => el.classList.add('expanded'); const ov = el.querySelector('.collapsible-overlay'); if (ov) { ov.addEventListener('click', e => { e.stopPropagation(); tgl(); }); } el.addEventListener('click', e => { if (!e.target.closest('input, select, textarea, button, label, summary, details, .collapsible-overlay')) tgl(); }); }
    function initCollapsibles() { document.querySelectorAll('.collapsible').forEach(makeCollapsible); }
    function updateManifest(design) { const link = document.querySelector('link[rel="manifest"]'); if (!link) return; const old = link.href; if (old?.startsWith('blob:')) URL.revokeObjectURL(old); const manifest = { name: design.appName, short_name: design.appName.split(' ')[0], start_url: "./index.html", scope: "./", display: "standalone", background_color: "#ffffff", theme_color: design.brandColors.primary || "#f04e37", orientation: "portrait-primary", icons: [{ src: design.icons.icon192, sizes: "192x192", type: "image/png" }, { src: design.icons.icon512, sizes: "512x512", type: "image/png" }] }; const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' }); link.href = URL.createObjectURL(blob); }
    function applyTheme(name) { document.documentElement.setAttribute('data-theme', name); localStorage.setItem('thixx-theme', name); document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === name)); const meta = document.querySelector('meta[name="theme-color"]'); if (meta) { const c = { dark: '#0f172a', thixx: '#f8f9fa', 'customer-brand': '#FCFCFD' }; meta.content = c[name] || '#FCFCFD'; } }
    function setupReadTabInitialState() { protocolCard.innerHTML = `<p class="placeholder-text">${t('placeholderRead')}</p>`; docLinkContainer.innerHTML = ''; readActions.classList.add('hidden'); }
});

