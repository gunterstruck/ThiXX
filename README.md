# ThiXX NFC Tool

Progressive Web App für NFC-basierte Abnahmeprotokolle in der Industrie, speziell entwickelt für Heizkabelsysteme und industrielle Wartungsprozesse.

## 🌐 Live Demo
https://gunterstruck.github.io/ThiXX/

## ✨ Features

- **NFC Tag lesen/schreiben** - Vollständige NFC-Unterstützung für industrielle Anwendungen
- **Offline-Funktionalität** - Service Worker für zuverlässigen Offline-Betrieb
- **PWA installierbar** - Als App auf Android-Geräten installierbar
- **Mehrsprachig** - Unterstützung für DE/EN/ES/FR
- **Datenexport/Import** - JSON-Export für Datensicherung
- **PDF-Dokumentenverwaltung** - Intelligentes Offline-Caching von verlinkten Betriebsanleitungen
- **Responsive Design** - Optimiert für mobile Geräte
- **Dark/Light Mode** - Mehrere Themes verfügbar

## 📱 Verwendung

### Schnellstart
1. App unter https://gunterstruck.github.io/ThiXX/ öffnen
2. Auf Android: "Zur Startseite hinzufügen" für App-Installation
3. NFC-Tag lesen: Tab "NFC LESEN" → "LESEN STARTEN"
4. NFC-Tag schreiben: Tab "NFC SCHREIBEN" → Formular ausfüllen → "SCHREIBEN STARTEN"

### PDF-Dokumentation verlinken
Die App ermöglicht es, Betriebsanleitungen und technische Dokumentationen direkt mit dem NFC-Tag zu verknüpfen:

1. **URL eintragen**: Im Feld "Dokumentation" die URL zum PDF eingeben (z.B. `https://example.com/betriebsanleitung.pdf`)
2. **Auf NFC schreiben**: Die URL wird zusammen mit den anderen Daten auf dem NFC-Tag gespeichert
3. **Beim Lesen**: 
   - Ist das PDF bereits im Cache → Button "Anleitung offline öffnen ✓"
   - PDF nicht im Cache → Button "Betriebsanleitung herunterladen ↓"
4. **Offline-Verfügbarkeit**: Einmal heruntergeladene PDFs bleiben im Browser-Cache für Offline-Nutzung

**Wichtig**: Die verlinkte PDF-Datei muss öffentlich zugänglich sein (CORS-Headers beachten).

### Unterstützte Datenfelder
- **HK.Nr.** - Heizkabel-Nummer
- **KKS** - Kraftwerk-Kennzeichensystem
- **Elektrische Werte**:
  - Leistung (kW)
  - Strom (A)
  - Spannung (V)
  - Widerstand (Ω)
- **Temperatureinstellungen**:
  - Regler (°C)
  - Sicherheitsregler/Begrenzer (°C)
  - Wächter (°C)
- **Messwertgeber**:
  - PT 100 (Stück)
  - NiCr-Ni (Stück)
- **Konfiguration**:
  - Anzahl Heizkabeleinheiten
  - Trennkasten
  - Heizkabeltyp
  - Schaltung (Stern/Dreieck/Wechselstrom)
- **Projekt- und Prüfdaten**:
  - Projekt Nr.
  - Geprüft von
  - Prüfdatum
- **Dokumentation** - URL zur Betriebsanleitung (PDF)

## 🛠️ Technologie-Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **APIs**: Web NFC API, Service Worker API, Cache API
- **PWA**: Web App Manifest, Service Worker
- **Offline-Caching**: Automatisches Caching von PDF-Dokumenten
- **Keine Abhängigkeiten**: Läuft ohne externe Bibliotheken

## 📋 Systemanforderungen

### Browser-Unterstützung
- ✅ **Chrome 89+** (Android) - Vollständige Unterstützung
- ✅ **Edge 89+** (Android) - Vollständige Unterstützung
- ❌ **Firefox** - Kein Web NFC Support
- ❌ **iOS Safari** - Kein Web NFC Support

### Hardware
- Android-Gerät mit NFC-Chip
- Android 5.0+ (API Level 21+)
- NFC muss in den Systemeinstellungen aktiviert sein

## 🚀 Installation & Deployment

### GitHub Pages (aktuell)
Repository ist bereits für GitHub Pages konfiguriert und unter https://gunterstruck.github.io/ThiXX/ erreichbar.

### Eigener Server
1. Repository klonen:
```bash
   git clone https://github.com/gunterstruck/ThiXX.git
```
2. Auf Webserver mit HTTPS deployen
3. Optional: Pfade in den Dateien anpassen (von `/ThiXX/` auf `/`)

### Lokale Entwicklung
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server

# Dann öffnen: http://localhost:8000/ThiXX/
```

**Wichtig**: NFC-Funktionalität erfordert HTTPS (außer localhost)

## 🔧 Konfiguration

### Design anpassen
Bearbeiten Sie `config.json`:
```json
{
  "design": "sigx"  // oder "thixx_standard"
}
```

### Sprachen hinzufügen
Neue JSON-Datei in `/lang/` erstellen und in `app.js` registrieren.

### PDF-Hosting für Dokumentationen
Für optimale Funktionalität sollten PDF-Dateien:
- Über HTTPS erreichbar sein
- CORS-Header erlauben: `Access-Control-Allow-Origin: *`
- Dauerhaft unter derselben URL verfügbar sein

## 📁 Projektstruktur
```
ThiXX/
├── index.html              # Haupt-HTML
├── offline.html            # Offline-Fallback
├── sw.js                   # Service Worker (inkl. PDF-Caching)
├── config.json             # Konfiguration
├── manifest.webmanifest    # PWA Manifest
├── assets/
│   ├── app.js             # Hauptanwendung
│   ├── style.css          # Styles
│   └── *.png              # Icons
└── lang/
    ├── de.json            # Deutsche Übersetzung
    ├── en.json            # Englische Übersetzung
    ├── es.json            # Spanische Übersetzung
    └── fr.json            # Französische Übersetzung
```

## 💾 Datenformat

### NFC-Tag Struktur
Die Daten werden im kompakten v1-Format gespeichert:
```
v1
HK:12345
KKS:ABC123
P:10.5
U:400
Doc:https://example.com/manual.pdf
...
```
Maximale Payload-Größe: 880 Bytes

### JSON Export/Import
Formulardaten können als JSON exportiert und später wieder importiert werden für Backup-Zwecke.

## 🐛 Bekannte Einschränkungen

- NFC-Schreibvorgang kann bei großen Datenmengen (>880 Bytes) fehlschlagen
- iOS-Geräte werden nicht unterstützt (Apple erlaubt keinen Web NFC Zugriff)
- Desktop-Browser können die App anzeigen, aber keine NFC-Funktionen nutzen
- PDF-Caching funktioniert nur bei CORS-konformen Servern

## 🔒 Sicherheit

- Content Security Policy implementiert
- Keine externen Abhängigkeiten
- Sanitization von NFC-Eingabedaten
- URL-Validierung für Dokumentations-Links
- HTTPS-Only für Produktivbetrieb

## 📝 Copyright & Lizenz

**© 2024 Günter Struck. Alle Rechte vorbehalten.**

Dieser Code ist urheberrechtlich geschützt und proprietär. Keine Nutzung, Vervielfältigung oder Verbreitung ohne ausdrückliche schriftliche Genehmigung des Autors. 

Für kommerzielle Lizenzen oder Kundenanpassungen kontaktieren Sie bitte den Autor.

---

**Entwickelt von**: Günter Struck  
**Kontakt**: thixx@online.de]  
**Version**: 1.0.0  
**Letztes Update**: Januar 2025
