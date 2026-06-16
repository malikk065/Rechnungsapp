// ============================================================
// Browser-Brücke für die Web-/Handy-App von Zakflow
//
// Stellt dasselbe window.api bereit wie der Electron-Preload,
// implementiert mit reinen Browser-APIs. So läuft derselbe
// renderer.js/store.js Code im Browser wie auf dem Desktop.
//
// Wird automatisch von build-web.js eingebunden — nicht im
// Electron-Build verwenden.
// ============================================================

(function () {
  'use strict';

  // --- Datei-Auswahl-Helfer ---
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      let settled = false;
      input.addEventListener('change', () => {
        settled = true;
        const file = input.files && input.files[0];
        document.body.removeChild(input);
        resolve(file || null);
      });
      // Abbruch erkennen (Fokus zurück ohne Auswahl)
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => {
          if (!settled) {
            if (input.parentNode) document.body.removeChild(input);
            resolve(null);
          }
        }, 500);
      });
      input.click();
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result; // data:<mime>;base64,XXXX
        const comma = result.indexOf(',');
        resolve({ base64: result.slice(comma + 1), dataUrl: result, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function downloadBytes(bytes, fileName, mimeType) {
    const blob = new Blob([bytes], { type: mimeType || 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.pdf') ? fileName : fileName + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Zwischenspeicher für Logo/Unterschrift-Uploads (Pseudo-Pfad → Daten)
  const _uploadStash = {};

  // --- QR-Code im Browser erzeugen (Canvas → PNG-Base64) ---
  function generateQRCodePNG(text) {
    if (typeof qrcode === 'undefined') {
      console.warn('qrcode-generator nicht geladen');
      return null;
    }
    try {
      const qr = qrcode(0, 'M'); // auto type, error correction M
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const cell = 6;
      const margin = cell * 2;
      const size = count * cell + margin * 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
          }
        }
      }
      return canvas.toDataURL('image/png').split(',')[1];
    } catch (e) {
      console.warn('QR-Erzeugung fehlgeschlagen:', e);
      return null;
    }
  }

  // --- Tesseract.js OCR im Browser ---
  let _ocrWorker = null;
  async function getOcrWorker() {
    if (_ocrWorker) return _ocrWorker;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js nicht geladen');
    }
    _ocrWorker = await Tesseract.createWorker('deu');
    return _ocrWorker;
  }

  // --- Bild bei Bedarf hochskalieren (für bessere OCR) ---
  function upscaleIfSmall(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.width >= 1000) { resolve(dataUrl); return; }
        const factor = Math.ceil(1200 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * factor;
        canvas.height = img.height * factor;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ============================================================
  // window.api — identische Schnittstelle wie Electron-Preload
  // ============================================================
  const api = {
    // --- Dark Mode (localStorage) ---
    getDarkMode: async () => localStorage.getItem('zakflow_darkMode') === 'true',
    setDarkMode: async (val) => { localStorage.setItem('zakflow_darkMode', val ? 'true' : 'false'); return true; },

    // --- Daten (Firebase ist primär; lokale Fallbacks = No-Ops) ---
    getSettings: async () => null,
    saveSettings: async () => true,
    getCustomers: async () => [],
    saveCustomers: async () => true,
    getInvoices: async () => [],
    saveInvoices: async () => true,
    getExpenses: async () => [],
    saveExpenses: async () => true,
    getDonations: async () => [],
    saveDonations: async () => true,
    getContacts: async () => [],
    saveContacts: async () => true,
    getDocuments: async () => [],
    saveDocuments: async () => true,
    getEvents: async () => [],
    saveEvents: async () => true,
    getSavedItems: async () => [],
    saveSavedItems: async () => true,
    getShoppingList: async () => [],
    saveShoppingList: async () => true,

    // --- PDF speichern (Browser-Download) ---
    savePDF: async (bytes, fileName) => {
      downloadBytes(bytes, fileName || 'Dokument');
      return fileName;
    },
    saveAutoPDF: async (bytes, fileName) => {
      downloadBytes(bytes, fileName || 'Dokument');
      return fileName;
    },

    // --- QR-Code ---
    generateQRCode: async (text) => generateQRCodePNG(text),

    // --- Logo / Unterschrift ---
    // get* geben null zurück → renderer fällt auf Firebase-Base64 zurück
    getLogo: async () => null,
    getSignature: async () => null,
    readLogoBase64: async (pseudoPath) => _uploadStash[pseudoPath] || null,
    readSignatureBase64: async (pseudoPath) => _uploadStash[pseudoPath] || null,

    uploadLogo: async () => {
      const file = await pickFile('image/*');
      if (!file) return null;
      const { base64, mimeType } = await fileToBase64(file);
      const pseudo = 'weblogo:' + Date.now();
      _uploadStash[pseudo] = { data: base64, mimeType: mimeType || 'image/png' };
      return pseudo;
    },
    uploadSignature: async () => {
      const file = await pickFile('image/*');
      if (!file) return null;
      const { base64, mimeType } = await fileToBase64(file);
      const pseudo = 'websig:' + Date.now();
      _uploadStash[pseudo] = { data: base64, mimeType: mimeType || 'image/png' };
      return pseudo;
    },
    removeSignature: async () => true,

    // --- Dokumente ---
    uploadDocument: async () => {
      const file = await pickFile();
      if (!file) return null;
      const { dataUrl } = await fileToBase64(file);
      return { filePath: dataUrl, fileName: file.name, size: file.size };
    },
    openDocument: async (filePathOrDataUrl) => {
      try { window.open(filePathOrDataUrl, '_blank'); return true; }
      catch (e) { return false; }
    },
    deleteDocumentFile: async () => true,
    importPDFs: async () => [],

    // --- Beleg-Scan (OCR) ---
    pickReceiptImage: async () => {
      const file = await pickFile('image/*');
      if (!file) return null;
      const { base64, mimeType } = await fileToBase64(file);
      return { base64, mimeType, fileName: file.name };
    },
    scanReceipt: async (payload) => {
      try {
        if (!payload || !payload.base64) return { ok: false, error: 'Kein Bild' };
        const worker = await getOcrWorker();
        const mime = payload.mimeType || 'image/png';
        let dataUrl = `data:${mime};base64,${payload.base64}`;
        dataUrl = await upscaleIfSmall(dataUrl);
        const { data } = await worker.recognize(dataUrl);
        return { ok: true, text: data.text || '', confidence: data.confidence };
      } catch (e) {
        console.error('OCR-Fehler:', e);
        return { ok: false, error: e.message };
      }
    },

    // --- Datenpfad (im Web bedeutungslos) ---
    getDataPath: async () => 'Cloud (Firebase)',
    chooseDataPath: async () => { return null; },
  };

  window.api = api;
})();
