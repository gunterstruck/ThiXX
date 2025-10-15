document.addEventListener('DOMContentLoaded', () => {
    // --- Design-Vorlagen ---
    const designs = {
        'default': { appName: "SIGX NFC Tool", theme: "customer-brand", lockTheme: false, icons: { icon192: "/ThiXX/assets/icon-192.png", icon512: "/ThiXX/assets/icon-512.png" }, brandColors: { primary: "#e45d45", secondary: "#6c6b66" } },
        'sigx': { appName: "SIGX NFC Tool", theme: "customer-brand", lockTheme: false, icons: { icon192: "/ThiXX/assets/icon-192.png", icon512: "/ThiXX/assets/icon-512.png" }, brandColors: { primary: "#e45d45", secondary: "#6c6b66" } },
        'thixx_standard': { appName: "ThiXX NFC Tool", theme: "dark", lockTheme: false, icons: { icon192: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png", icon512: "/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png" }, brandColors: { primary: "#f04e37", secondary: "#6c6b66" } }
    };

    // --- DOM Element References ---
    const tabs = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const nfcStatusBadge = document.getElementById('nfc-status-badge');
    const copyToFormBtn = document.getElementById('copy-to-form-btn');
    const saveJsonBtn = document.getElementById('save-json-btn');
    const loadJsonInput = document.getElementById('load-json-input');
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
    const eventLogOutput = document.getElementById('event-log-output'); // NEU

    // --- State Variables ---
    let isNfcActionActive = false;
    let isCooldownActive = false;
    let abortController = null;
    let scannedDataObject = null;
    let eventLog = []; // NEU

    // --- App Initialization ---
    fetch('/ThiXX/config.json').then(res => res.ok ? res.json() : Promise.reject('config.json not found')).then(initializeApp).catch(err => { console.warn('Konfigurationsdatei nicht geladen, Fallback wird verwendet.', err); initializeApp({ design: "default" }); });

    function initializeApp(config) {
        applyConfig(config);
        setupEventListeners();
        setTodaysDate();
        checkNfcSupport();
        initCollapsibles();
        setupReadTabInitialState();
        switchTab('read-tab'); 
    }
    
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/ThiXX/sw.js', { scope: '/ThiXX/' }).then(reg => console.log('Service Worker registered:', reg.scope)).catch(err => console.error('Service Worker registration failed:', err));
        });
    }

    function setupEventListeners() {
        tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
        nfcStatusBadge.addEventListener('click', handleNfcAction);
        copyToFormBtn.addEventListener('click', populateFormFromScan);
        saveJsonBtn.addEventListener('click', saveFormAsJson);
        loadJsonInput.addEventListener('change', loadJsonIntoForm);
        form.addEventListener('input', updatePayloadOnChange);
        form.addEventListener('change', updatePayloadOnChange);
        document.getElementById('has_PT100').addEventListener('change', (e) => { document.getElementById('PT 100').disabled = !e.target.checked; });
        document.getElementById('has_NiCr-Ni').addEventListener('change', (e) => { document.getElementById('NiCr-Ni').disabled = !e.target.checked; });
    }

    // --- NEUE LOGGING FUNKTIONEN ---
    function renderLog() {
        if (!eventLogOutput) return;
        eventLogOutput.innerHTML = eventLog
            .map(entry => `<div class="log-entry ${entry.type}"><span class="log-timestamp">${entry.timestamp}</span> ${entry.message}</div>`)
            .join('');
    }

    function addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        eventLog.unshift({ timestamp, message, type }); // unshift statt push, um neueste oben zu haben
        if (eventLog.length > 5) {
            eventLog.pop();
        }
        renderLog();
    }
    // --- ENDE LOGGING FUNKTIONEN ---

    async function isUrlCached(url) {
        if (!('caches' in window)) return false;
        try {
            const cache = await caches.open('thixx-docs-v1');
            const response = await cache.match(url);
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
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ action: 'cache-doc', url: url });
                button.textContent = 'Offline verfügbar ✓';
                button.disabled = true;
            }
        } else {
            showMessage('Sie sind offline. Anleitung wird später geladen.', 'info');
            const pendingDownloads = JSON.parse(localStorage.getItem('pendingDownloads') || '[]');
            if (!pendingDownloads.includes(url)) {
                pendingDownloads.push(url);
                localStorage.setItem('pendingDownloads', JSON.stringify(pendingDownloads));
            }
            button.textContent = 'Download ausstehend...';
            button.disabled = true;
        }
    }

    async function displayParsedData(data) {
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
        
        docLinkContainer.innerHTML = '';
        if (data['Dokumentation']) {
            const url = data['Dokumentation'];
            const button = document.createElement('button');
            button.className = 'btn doc-link-btn';
            button.dataset.url = url;

            const isCached = await isUrlCached(url);

            if (isCached) {
                button.textContent = 'Anleitung offline öffnen ✓';
                button.onclick = () => window.open(url, '_blank');
            } else {
                if (navigator.onLine) {
                    button.textContent = 'Betriebsanleitung herunterladen ↓';
                } else {
                    button.textContent = 'Offline - Später herunterladen';
                }
                button.addEventListener('click', handleDocButtonClick);
            }
            docLinkContainer.appendChild(button);
        }
    }

    function applyConfig(config) { const selectedDesign = designs[config.design] || designs['default']; document.title = selectedDesign.appName; updateManifest(selectedDesign); applyTheme(selectedDesign.theme); if (selectedDesign.lockTheme) { if (themeSwitcher) themeSwitcher.classList.add('hidden'); } else { if (themeSwitcher) themeSwitcher.classList.remove('hidden'); } const customerBtnImg = document.querySelector('.theme-btn[data-theme="customer-brand"] img'); if (customerBtnImg && selectedDesign.icons && selectedDesign.icons.icon512) { customerBtnImg.src = selectedDesign.icons.icon512; } const appleIcon = document.querySelector('link[rel="apple-touch-icon"]'); if (appleIcon && selectedDesign.icons && selectedDesign.icons.icon192) { appleIcon.href = selectedDesign.icons.icon192; } if (selectedDesign.brandColors && selectedDesign.brandColors.primary) { document.documentElement.style.setProperty('--primary-color-override', selectedDesign.brandColors.primary); } if (selectedDesign.brandColors && selectedDesign.brandColors.secondary) { document.documentElement.style.setProperty('--secondary-color-override', selectedDesign.brandColors.secondary); } }
    function updateManifest(design) { const manifestLink = document.querySelector('link[rel="manifest"]'); if (!manifestLink) return; const newManifest = { name: design.appName, short_name: design.appName.split(' ')[0], start_url: "/ThiXX/index.html", scope: "/ThiXX/", display: "standalone", background_color: "#ffffff", theme_color: design.brandColors.primary || "#f04e37", orientation: "portrait-primary", icons: [{ src: design.icons.icon192, sizes: "192x192", type: "image/png" }, { src: design.icons.icon512, sizes: "512x512", type: "image/png" }] }; const blob = new Blob([JSON.stringify(newManifest)], { type: 'application/json' }); manifestLink.href = URL.createObjectURL(blob); }
    function applyTheme(themeName) { const themeButtons = document.querySelectorAll('.theme-btn'); document.body.setAttribute('data-theme', themeName); localStorage.setItem('thixx-theme', themeName); themeButtons.forEach(btn => { btn.classList.toggle('active', btn.dataset.theme === themeName); }); const metaThemeColor = document.querySelector('meta[name="theme-color"]'); if (metaThemeColor) { const colors = { dark: '#0f172a', thixx: '#f8f9fa', 'customer-brand': '#FCFCFD' }; metaThemeColor.setAttribute('content', colors[themeName] || '#FCFCFD'); } }
    document.querySelectorAll('.theme-btn').forEach(btn => { btn.addEventListener('click', () => applyTheme(btn.dataset.theme)); });
    function setupReadTabInitialState(){ protocolCard.innerHTML=`<p class="placeholder-text">Noch keine Daten gelesen. Bitte NFC-Tag zum Lesen halten.</p>`; docLinkContainer.innerHTML = ''; readActions.classList.add('hidden'); }
    function initCollapsibles(){document.querySelectorAll('.collapsible').forEach(el=>makeCollapsible(el))}
    function checkNfcSupport(){if('NDEFReader'in window){setNfcBadge('idle')}else{setNfcBadge('unsupported');nfcFallback.classList.remove('hidden');nfcStatusBadge.disabled=true}}
    
    function switchTab(tabId) {
        abortNfcAction();
        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-link[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');
        
        if (legalInfoContainer) {
            legalInfoContainer.classList.toggle('hidden', tabId !== 'read-tab');
        }

        setNfcBadge('idle');
        if (tabId === 'write-tab') {
            updatePayloadOnChange();
        }
    }

    function showMessage(text,type='info',duration=4000){
        messageBanner.textContent=text;
        messageBanner.className='message-banner';
        messageBanner.classList.add(type);
        messageBanner.classList.remove('hidden');
        setTimeout(()=>messageBanner.classList.add('hidden'),duration);
        addLogEntry(text, type); // Log-Eintrag hinzufügen
    }

    function setTodaysDate(){const today=new Date();const yyyy=today.getFullYear();const mm=String(today.getMonth()+1).padStart(2,'0');const dd=String(today.getDate()).padStart(2,'0');document.getElementById('am').value=`${yyyy}-${mm}-${dd}`}
    function setNfcBadge(state,message=''){const isWriteMode=document.querySelector('.tab-link[data-tab="write-tab"]').classList.contains('active');const states={unsupported:['NFC nicht unterstützt','err'],idle:[isWriteMode?'Schreiben starten':'Lesen starten','info'],scanning:['Scannen...','info'],writing:['Schreiben...','info'],success:[message||'Erfolgreich!','ok'],error:[message||'Fehler','err'],cooldown:['Bitte warten...','info']};const[text,className]=states[state]||states['idle'];nfcStatusBadge.textContent=text;nfcStatusBadge.className='nfc-badge';nfcStatusBadge.classList.add(className)}
    function getReadableError(error){const errorMap={'NotAllowedError':'Zugriff verweigert. Bitte NFC-Berechtigung erteilen.','NotSupportedError':'NFC wird nicht unterstützt.','NotReadableError':'Tag konnte nicht gelesen werden.','NetworkError':'Netzwerkfehler beim NFC-Zugriff.','InvalidStateError':'Ungültiger Zustand. Bitte App neu laden.','DataError':'Daten konnten nicht verarbeitet werden.','AbortError':'Vorgang abgebrochen.'};return errorMap[error.name]||error.message||'Unbekannter Fehler'}
    function startCooldown(){isCooldownActive=true;setNfcBadge('cooldown');setTimeout(()=>{isCooldownActive=false;setNfcBadge('idle')},2000)}
    function abortNfcAction(){if(abortController){abortController.abort();abortController=null}isNfcActionActive=false}
    
    async function handleNfcAction() {
        if (isNfcActionActive || isCooldownActive) { return; }
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
                setNfcBadge('writing');
                showMessage('Bitte NFC-Tag zum Schreiben an das Gerät halten...', 'info');
                generateAndShowPayload();
                const payload = payloadOutput.value;
                if (new TextEncoder().encode(payload).length > 880) {
                    throw new Error('Daten sind zu groß für den NFC-Tag.');
                }
                await ndef.write(payload, { signal: abortController.signal });
                setNfcBadge('success', 'Tag geschrieben!');
                showMessage('Daten erfolgreich auf den Tag geschrieben.', 'ok');
                startCooldown();
            } else {
                setNfcBadge('scanning');
                showMessage('Bitte NFC-Tag zum Lesen an das Gerät halten...', 'info');
                await new Promise((resolve, reject) => {
                    const onAbort = () => {
                        ndef.onreading = null;
                        ndef.onreadingerror = null;
                        reject(new DOMException('Vorgang abgebrochen.', 'AbortError'));
                    };
                    abortController.signal.addEventListener('abort', onAbort, { once: true });
                    ndef.onreading = (event) => {
                        abortController.signal.removeEventListener('abort', onAbort);
                        resolve(event);
                    };
                    ndef.onreadingerror = (event) => {
                        abortController.signal.removeEventListener('abort', onAbort);
                        reject(new DOMException('Tag konnte nicht gelesen werden.', 'NotReadableError'));
                    };
                    ndef.scan({ signal: abortController.signal }).catch(err => {
                        abortController.signal.removeEventListener('abort', onAbort);
                        reject(err);
                    });
                }).then((event) => {
                    abortNfcAction();
                    console.log('NFC Scan-Ergebnis:', event);

                    const records = event.message.records;
                    if (!records || records.length === 0) {
                        throw new Error('NFC-Tag ist leer.');
                    }
                    
                    const textRecord = records.find(record => record.recordType === 'text');

                    if (textRecord) {
                        const text = new TextDecoder().decode(textRecord.data);
                        processNfcData(text);
                        setNfcBadge('success', 'Tag gelesen!');
                        showMessage('NFC-Tag erfolgreich gelesen!', 'ok');
                    } else {
                        throw new Error('Kein bekannter Textinhalt gefunden.');
                    }
                    startCooldown();
                });
            }
        } catch (error) {
            abortNfcAction();
            const readableError = getReadableError(error);
            setNfcBadge('error', readableError);
            showMessage(readableError, 'err');
            startCooldown();
        } finally {
            isNfcActionActive = false;
        }
    }

    function processNfcData(text){rawDataOutput.value=text;try{scannedDataObject=parseNfcText(text);displayParsedData(scannedDataObject);readActions.classList.remove('hidden');readResultContainer.classList.add('expanded')}catch(e){showMessage(`Fehler beim Verarbeiten: ${e.message}`,'err');setupReadTabInitialState();scannedDataObject=null}}
    function parseNfcText(text){const data={};text=text.trim();if(text.startsWith('v1')){const content=text.substring(2).trim();const regex=/([^:\n]+):([^\n]*)/g;let match;while((match=regex.exec(content))!==null){const key=reverseFieldMap[match[1].trim()]||match[1].trim();data[key]=match[2].trim()}if(Object.keys(data).length===0)throw new Error("v1-Format, aber keine Daten gefunden.");return data}throw new Error("Kein bekanntes Format erkannt.")}
    function createDataPair(label,value,unit=''){if(!value)return'';return`
            <div class="data-pair">
                <span class="data-pair-label">${label}</span>
                <span class="data-pair-value">${value} ${unit}</span>
            </div>
        `}
    function updatePayloadOnChange(){if(document.querySelector('.tab-link[data-tab="write-tab"]').classList.contains('active')){generateAndShowPayload()}}
    function generateAndShowPayload(){const formData=getFormData();const payload=formatToCompact(formData);payloadOutput.value=payload;const byteCount=new TextEncoder().encode(payload).length;payloadSize.textContent=`${byteCount} / 880 Bytes`;payloadSize.classList.toggle('limit-exceeded',byteCount>880)}
    function getFormData(){const formData=new FormData(form);const data={};for(const[key,value]of formData.entries()){if(value.trim())data[key]=value.trim()}if(!document.getElementById('has_PT100').checked)delete data['PT 100'];if(!document.getElementById('has_NiCr-Ni').checked)delete data['NiCr-Ni'];delete data['has_PT100'];delete data['has_NiCr-Ni'];return data}
    function formatToCompact(data){let compactString='v1';const parts=[];for(const[key,shortKey]of Object.entries(fieldMap)){if(data[key])parts.push(`${shortKey}:${data[key]}`)}if(parts.length>0)compactString+='\n'+parts.join('\n');return compactString}
    function populateFormFromScan(){if(!scannedDataObject){showMessage('Keine Daten zum Übernehmen vorhanden.','err');return}form.reset();setTodaysDate();for(const[key,value]of Object.entries(scannedDataObject)){const input=form.elements[key];if(input){if(input.type==='radio'){form.querySelectorAll(`input[name="${key}"]`).forEach(radio=>{if(radio.value===value)radio.checked=true})}else if(input.type==='checkbox'){input.checked=(value==='true'||value==='on')}else{input.value=value}}}const pt100Input=document.getElementById('PT 100');const hasPt100Checkbox=document.getElementById('has_PT100');if(scannedDataObject['PT 100']){pt100Input.value=scannedDataObject['PT 100'];pt100Input.disabled=false;hasPt100Checkbox.checked=true}else{pt100Input.disabled=true;hasPt100Checkbox.checked=false}const niCrInput=document.getElementById('NiCr-Ni');const hasNiCrCheckbox=document.getElementById('has_NiCr-Ni');if(scannedDataObject['NiCr-Ni']){niCrInput.value=scannedDataObject['NiCr-Ni'];niCrInput.disabled=false;hasNiCrCheckbox.checked=true}else{niCrInput.disabled=true;hasNiCrCheckbox.checked=false}switchTab('write-tab');document.getElementById('write-form-container').classList.add('expanded');showMessage('Daten in Formular übernommen.','ok')}
    function saveFormAsJson(){const data=getFormData();const jsonString=JSON.stringify(data,null,2);const blob=new Blob([jsonString],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;const today=new Date().toISOString().slice(0,10);a.download=`thixx-${today}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showMessage('Daten als JSON gespeichert.','ok')}
    function loadJsonIntoForm(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=(e)=>{try{const data=JSON.parse(e.target.result);scannedDataObject=data;populateFormFromScan();showMessage('JSON-Datei erfolgreich geladen.','ok')}catch(error){showMessage(`Fehler beim Laden: ${error.message}`,'err')}finally{event.target.value=null}};reader.readAsText(file)}
    function makeCollapsible(el){if(!el||el.dataset.collapsibleApplied)return;el.dataset.collapsibleApplied='true';const toggle=()=>{if(el.classList.contains('expanded'))return;el.classList.add('expanded')};const overlay=el.querySelector('.collapsible-overlay');if(overlay){overlay.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();toggle()})}el.addEventListener('click',(e)=>{const tag=(e.target.tagName||'').toLowerCase();if(['input','select','textarea','button','label','summary','details'].includes(tag)||e.target.closest('.collapsible-overlay'))return;toggle()})}
    const fieldMap={'HK.Nr.':'HK','KKS':'KKS','Leistung':'P','Strom':'I','Spannung':'U','Widerstand':'R','Regler':'Reg','Sicherheitsregler/Begrenzer':'Sich','Wächter':'Wäch','Projekt Nr.':'Proj','Anzahl Heizkabeleinheiten':'Anz','Trennkasten':'TB','Heizkabeltyp':'HKT','Schaltung':'Sch','PT 100':'PT100','NiCr-Ni':'NiCr','geprüft von':'Chk','am':'Date', 'Dokumentation': 'Doc'};
    const reverseFieldMap=Object.fromEntries(Object.entries(fieldMap).map(([k,v])=>[v,k]));
});

