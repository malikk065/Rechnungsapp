#!/usr/bin/env node
// ============================================================
// build-web.js
//
// Generiert die Web-/Handy-App (web/) aus der EINEN Codebasis (src/).
// Desktop und Web teilen sich damit renderer.js, store.js,
// pdf-generator.js, zugferd.js und styles.css.
//
// Aufruf:  node build-web.js
//
// Was passiert:
//  - Logik-Dateien aus src/ → web/ kopieren
//  - src/index.html → web/index.html transformieren:
//      * node_modules-Skripte → CDN-URLs
//      * Browser-Brücke (api-shim.js) + Tesseract + QR-Lib einbinden
//      * mobile.css + PWA-Meta-Tags einfügen
//  - team.html, manifest.json, sw.js, Icons bleiben unberührt
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const WEB = path.join(ROOT, 'web');

// Firebase-Version (muss zur src/firebase-config.js passen)
const FB_VERSION = '10.14.1';

// CDN-Ersetzungen für die node_modules-Skripte
const CDN = {
  'pdf-lib': 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'firebase-app': `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-compat.js`,
  'firebase-firestore': `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore-compat.js`,
  'firebase-auth': `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth-compat.js`,
};
const TESSERACT_CDN = 'https://unpkg.com/tesseract.js@7/dist/tesseract.min.js';
const QRCODE_CDN = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';

// 1. Logik-Dateien kopieren
const filesToCopy = [
  'renderer.js',
  'store.js',
  'pdf-generator.js',
  'zugferd.js',
  'styles.css',
  'mobile.css',
  'firebase-config.js',
];
for (const f of filesToCopy) {
  const from = path.join(SRC, f);
  const to = path.join(WEB, f);
  if (!fs.existsSync(from)) {
    console.warn(`⚠️  ${f} fehlt in src/ — übersprungen`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`✓ kopiert: ${f}`);
}

// 2. index.html transformieren
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// 2a. mobile.css + PWA-Meta-Tags nach dem styles.css-Link einfügen
const pwaHead = `  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="mobile.css">
  <meta name="theme-color" content="#2563eb">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Zakflow">
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icon-192.png">`;
html = html.replace(/  <link rel="stylesheet" href="styles\.css">/, pwaHead);

// 2b. Viewport für Mobile optimieren (kein User-Zoom-Sperre, aber sauber)
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'
);

// 2c. Skript-Block am Ende ersetzen
const oldScripts = /  <script>window\._scriptErrors[\s\S]*?<\/script>\s*<\/body>/;
const newScripts = `  <script>window._scriptErrors = [];</script>
  <script src="${CDN['pdf-lib']}" onerror="window._scriptErrors.push('pdf-lib')"></script>
  <script src="${CDN['firebase-app']}" onerror="window._scriptErrors.push('firebase-app')"></script>
  <script src="${CDN['firebase-firestore']}" onerror="window._scriptErrors.push('firebase-firestore')"></script>
  <script src="${CDN['firebase-auth']}" onerror="window._scriptErrors.push('firebase-auth')"></script>
  <script src="${TESSERACT_CDN}"></script>
  <script src="${QRCODE_CDN}"></script>
  <script src="api-shim.js"></script>
  <script src="firebase-config.js" onerror="window._scriptErrors.push('firebase-config')"></script>
  <script src="store.js" onerror="window._scriptErrors.push('store')"></script>
  <script src="zugferd.js" onerror="window._scriptErrors.push('zugferd')"></script>
  <script src="pdf-generator.js" onerror="window._scriptErrors.push('pdf-generator')"></script>
  <script src="renderer.js" onerror="window._scriptErrors.push('renderer')"></script>
  <script>
    // Service Worker für PWA / Offline registrieren
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
      });
    }
  </script>
</body>`;

if (!oldScripts.test(html)) {
  console.error('✗ Skript-Block in src/index.html nicht gefunden — Build abgebrochen');
  process.exit(1);
}
html = html.replace(oldScripts, newScripts);

fs.writeFileSync(path.join(WEB, 'index.html'), html, 'utf8');
console.log('✓ generiert: web/index.html');

console.log('\n✅ Web-App gebaut. Deploy mit:  npx firebase-tools deploy --only hosting');
