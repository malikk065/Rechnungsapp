// PDF Generator mit pdf-lib
// pdf-lib wird als UMD-Script im HTML vor diesem Skript geladen

async function generateInvoicePDF({ invoice, settings, customer, totals, logoData, signatureData, qrData }) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const doc = await PDFDocument.create();
  const A4 = [595.28, 841.89];

  // Fonts
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Colors
  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.4, 0.4, 0.45);
  const lightGray = rgb(0.85, 0.85, 0.88);
  const accent = rgb(0, 0.44, 0.89);
  const white = rgb(1, 1, 1);

  const marginLeft = 50;
  const marginRight = 50;
  const footerReserve = 60; // Platz für Fußzeile am unteren Seitenrand

  // Pagination-Context
  const ctx = {
    doc,
    page: doc.addPage(A4),
    pageNum: 1,
    pages: [],
  };
  ctx.pages.push(ctx.page);
  const { width, height } = ctx.page.getSize();
  const contentWidth = width - marginLeft - marginRight;

  let y = height - 50;

  function newPage() {
    ctx.page = doc.addPage(A4);
    ctx.pageNum++;
    ctx.pages.push(ctx.page);
    y = height - 50;
  }

  // Wenn weniger als `needed` Pixel bis zum Footer übrig sind → neue Seite
  function ensureSpace(needed) {
    if (y - needed < footerReserve) {
      newPage();
      return true;
    }
    return false;
  }

  // =====================
  // HEADER - Logo + Firmendaten
  // =====================
  const headerTop = y;
  let logoWidth = 0;

  // Logo (links)
  if (logoData && logoData.data) {
    try {
      let logoImage;
      if (logoData.mimeType.includes('png')) {
        logoImage = await doc.embedPng(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      } else if (logoData.mimeType.includes('jpeg') || logoData.mimeType.includes('jpg')) {
        logoImage = await doc.embedJpg(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      }

      if (logoImage) {
        const logoDims = logoImage.scale(1);
        const maxH = 60;
        const maxW = 150;
        const scale = Math.min(maxW / logoDims.width, maxH / logoDims.height, 1);
        const w = logoDims.width * scale;
        const h = logoDims.height * scale;
        ctx.page.drawImage(logoImage, {
          x: marginLeft,
          y: headerTop - h,
          width: w,
          height: h,
        });
        logoWidth = w + 20;
      }
    } catch (e) {
      console.error('Logo-Embed-Fehler:', e);
    }
  }

  // Firmendaten (rechts)
  const companyX = width - marginRight;
  const companyLines = [
    { text: settings.company.name || '', font: fontBold, size: 12 },
    { text: settings.company.address || '', font: fontRegular, size: 9 },
    { text: `${settings.company.zip || ''} ${settings.company.city || ''}`.trim(), font: fontRegular, size: 9 },
    { text: settings.company.phone ? `Tel: ${settings.company.phone}` : '', font: fontRegular, size: 9 },
    { text: settings.company.email || '', font: fontRegular, size: 9 },
    { text: settings.company.website || '', font: fontRegular, size: 9 },
  ].filter(l => l.text);

  let companyY = headerTop;
  for (const line of companyLines) {
    const tw = line.font.widthOfTextAtSize(line.text, line.size);
    ctx.page.drawText(line.text, {
      x: companyX - tw,
      y: companyY - line.size,
      size: line.size,
      font: line.font,
      color: line === companyLines[0] ? black : gray,
    });
    companyY -= line.size + 4;
  }

  y = Math.min(companyY, headerTop - 70) - 20;

  // =====================
  // Absenderzeile (klein)
  // =====================
  const senderLine = [
    settings.company.name,
    settings.company.address,
    `${settings.company.zip} ${settings.company.city}`.trim()
  ].filter(Boolean).join(' · ');

  ctx.page.drawText(senderLine, {
    x: marginLeft,
    y: y,
    size: 7,
    font: fontRegular,
    color: gray,
  });

  // Underline
  y -= 3;
  ctx.page.drawLine({
    start: { x: marginLeft, y },
    end: { x: marginLeft + 250, y },
    thickness: 0.5,
    color: lightGray,
  });

  y -= 16;

  // =====================
  // Kundenadresse
  // =====================
  if (customer) {
    const addrLines = [
      customer.name,
      customer.street,
      `${customer.zip || ''} ${customer.city || ''}`.trim(),
    ].filter(Boolean);

    for (const line of addrLines) {
      ctx.page.drawText(line, {
        x: marginLeft,
        y,
        size: 11,
        font: line === addrLines[0] ? fontBold : fontRegular,
        color: black,
      });
      y -= 16;
    }
  }

  y -= 20;

  // =====================
  // Rechnungsdetails (rechts)
  // =====================
  const detailsX = width - marginRight - 180;
  let detailY = y + 50;

  const details = [
    ['Rechnungsnummer:', invoice.number],
    ['Rechnungsdatum:', formatDateForPDF(invoice.date)],
    ['Zahlungsziel:', formatDateForPDF(addDays(invoice.date, invoice.dueDays || 14))],
  ];

  if (settings.company.taxNumber) {
    details.push(['Steuernummer:', settings.company.taxNumber]);
  }
  if (settings.company.vatId) {
    details.push(['USt-IdNr.:', settings.company.vatId]);
  }

  for (const [label, value] of details) {
    ctx.page.drawText(label, {
      x: detailsX,
      y: detailY,
      size: 8,
      font: fontRegular,
      color: gray,
    });
    ctx.page.drawText(value || '', {
      x: detailsX + 95,
      y: detailY,
      size: 8,
      font: fontBold,
      color: black,
    });
    detailY -= 14;
  }

  // =====================
  // RECHNUNG / GUTSCHRIFT Titel
  // =====================
  const isGutschrift = invoice.type === 'gutschrift';
  const docTitle = isGutschrift ? 'GUTSCHRIFT' : 'RECHNUNG';
  ctx.page.drawText(docTitle, {
    x: marginLeft,
    y: y,
    size: 22,
    font: fontBold,
    color: isGutschrift ? rgb(0.69, 0.32, 0.87) : black,
  });

  // Referenz bei Gutschrift
  if (isGutschrift && invoice.relatedInvoice) {
    y -= 18;
    ctx.page.drawText(`Zu Rechnung: ${invoice.relatedInvoice}`, {
      x: marginLeft,
      y,
      size: 9,
      font: fontRegular,
      color: gray,
    });
  }

  y -= 40;

  // =====================
  // Positionen-Tabelle
  // =====================
  // Verwende den vom Store berechneten taxMode (Invoice-Override > Settings-Mode)
  const taxMode = totals.taxMode || invoice.taxMode || settings.taxMode || 'kleinunternehmer';
  const isKlein = taxMode === 'kleinunternehmer';

  // Spalten-Definition
  const cols = isKlein
    ? [
        { label: 'Pos.', width: 35, align: 'left' },
        { label: 'Beschreibung', width: 230, align: 'left' },
        { label: 'Menge', width: 50, align: 'right' },
        { label: 'Einheit', width: 45, align: 'left' },
        { label: 'Einzelpreis', width: 75, align: 'right' },
        { label: 'Gesamt', width: 75, align: 'right' },
      ]
    : [
        { label: 'Pos.', width: 30, align: 'left' },
        { label: 'Beschreibung', width: 190, align: 'left' },
        { label: 'Menge', width: 45, align: 'right' },
        { label: 'Einheit', width: 40, align: 'left' },
        { label: 'Einzelpreis', width: 70, align: 'right' },
        { label: 'MwSt', width: 40, align: 'right' },
        { label: 'Gesamt', width: 75, align: 'right' },
      ];

  // Helper: Tabellen-Header zeichnen (wird auch nach Seitenumbruch wiederverwendet)
  const tableHeaderH = 22;
  function drawTableHeader() {
    ctx.page.drawRectangle({
      x: marginLeft,
      y: y - tableHeaderH + 6,
      width: contentWidth,
      height: tableHeaderH,
      color: rgb(0.95, 0.95, 0.96),
    });
    let cx = marginLeft + 4;
    for (const col of cols) {
      const textX = col.align === 'right'
        ? cx + col.width - fontBold.widthOfTextAtSize(col.label, 8) - 4
        : cx;
      ctx.page.drawText(col.label, {
        x: textX, y: y - 10, size: 8, font: fontBold, color: gray,
      });
      cx += col.width;
    }
    y -= tableHeaderH + 4;
  }

  drawTableHeader();

  // Tabellen-Zeilen mit Pagination
  const items = invoice.items || [];
  const rowH = 20;
  for (let i = 0; i < items.length; i++) {
    // Vor jeder Zeile prüfen: brauchen wir neue Seite?
    if (y - rowH < footerReserve) {
      newPage();
      drawTableHeader();
    }

    const item = items[i];
    const itemTotal = (Number(item.quantity) || 0) * (Number(item.price) || 0);

    // Alternating row background
    if (i % 2 === 1) {
      ctx.page.drawRectangle({
        x: marginLeft,
        y: y - 12,
        width: contentWidth,
        height: rowH,
        color: rgb(0.98, 0.98, 0.99),
      });
    }

    let colX = marginLeft + 4;
    const rowData = isKlein
      ? [
          String(i + 1),
          item.description || '',
          formatNumber(item.quantity),
          item.unit || 'Stk.',
          formatCurrencyPDF(item.price),
          formatCurrencyPDF(itemTotal),
        ]
      : [
          String(i + 1),
          item.description || '',
          formatNumber(item.quantity),
          item.unit || 'Stk.',
          formatCurrencyPDF(item.price),
          `${item.taxRate != null ? item.taxRate : 19}%`,
          formatCurrencyPDF(itemTotal),
        ];

    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      let text = rowData[c] || '';

      // Truncate description if too long
      if (c === 1) {
        const maxW = col.width - 8;
        while (fontRegular.widthOfTextAtSize(text, 9) > maxW && text.length > 3) {
          text = text.slice(0, -4) + '...';
        }
      }

      const tw = fontRegular.widthOfTextAtSize(text, 9);
      const textX = col.align === 'right' ? colX + col.width - tw - 4 : colX;

      ctx.page.drawText(text, {
        x: textX,
        y: y - 4,
        size: 9,
        font: fontRegular,
        color: black,
      });
      colX += col.width;
    }

    y -= rowH;
  }

  // Tabellen-Linie unten
  y -= 4;
  ctx.page.drawLine({
    start: { x: marginLeft, y },
    end: { x: width - marginRight, y },
    thickness: 0.5,
    color: lightGray,
  });

  y -= 24;

  // =====================
  // Summen (geschätzter Platzbedarf: Netto + MwSt-Gruppen + Brutto ≈ 60-100 px)
  // =====================
  const numTaxGroups = (totals.taxGroups && !isKlein) ? Object.keys(totals.taxGroups).length : 0;
  const summaryNeeded = 60 + numTaxGroups * 16;
  ensureSpace(summaryNeeded);

  const sumX = width - marginRight - 180;
  const valX = width - marginRight;

  // Netto
  drawSumLine(ctx.page, 'Nettobetrag:', formatCurrencyPDF(totals.netto), sumX, valX, y, fontRegular, fontRegular, 10, gray, black);
  y -= 16;

  if (!isKlein) {
    // MwSt aufschlüsseln — bevorzugt aus totals.taxGroups (consistent mit Store)
    const taxGroups = totals.taxGroups || {};
    const sortedRates = Object.keys(taxGroups).sort((a, b) => Number(a) - Number(b));
    for (const rate of sortedRates) {
      const group = taxGroups[rate];
      const amount = typeof group === 'object' ? group.mwst : group;
      drawSumLine(ctx.page, `MwSt ${rate}%:`, formatCurrencyPDF(amount), sumX, valX, y, fontRegular, fontRegular, 10, gray, black);
      y -= 16;
    }
  }

  // Brutto-Linie ÜBER dem Text
  y -= 6;
  ctx.page.drawLine({
    start: { x: sumX, y },
    end: { x: valX, y },
    thickness: 1.5,
    color: black,
  });
  y -= 16;

  // Brutto
  const bruttoLabel = isKlein ? 'Gesamtbetrag:' : 'Bruttobetrag:';
  const bruttoPrefix = isGutschrift ? '-' : '';
  drawSumLine(ctx.page, bruttoLabel, bruttoPrefix + formatCurrencyPDF(totals.brutto), sumX, valX, y, fontBold, fontBold, 12, black, black);
  y -= 30;

  // =====================
  // Kleinunternehmer-Hinweis
  // =====================
  if (isKlein) {
    ensureSpace(20);
    ctx.page.drawText('Gemäß §19 UStG wird keine Umsatzsteuer berechnet.', {
      x: marginLeft, y, size: 8, font: fontRegular, color: gray,
    });
    y -= 20;
  }

  // =====================
  // Bemerkungen
  // =====================
  if (invoice.notes) {
    const noteLines = wrapText(invoice.notes, fontRegular, 9, contentWidth);
    ensureSpace(24 + noteLines.length * 13);
    y -= 10;
    ctx.page.drawText('Bemerkungen:', {
      x: marginLeft, y, size: 9, font: fontBold, color: black,
    });
    y -= 14;
    for (const line of noteLines) {
      ctx.page.drawText(line, {
        x: marginLeft, y, size: 9, font: fontRegular, color: gray,
      });
      y -= 13;
    }
  }

  // =====================
  // Zahlungshinweis
  // =====================
  y -= 10;

  if (isGutschrift) {
    ensureSpace(30);
    ctx.page.drawText(`Der Betrag von ${formatCurrencyPDF(totals.brutto)} wird gutgeschrieben.`, {
      x: marginLeft, y, size: 9, font: fontRegular, color: black,
    });
    y -= 20;
  } else if (invoice.paymentMethod === 'bar') {
    ensureSpace(60);
    ctx.page.drawText('Zahlungsart: Bar bezahlt', {
      x: marginLeft, y, size: 10, font: fontBold, color: black,
    });
    y -= 16;
    ctx.page.drawText(`Der Betrag von ${formatCurrencyPDF(totals.brutto)} wurde bar entgegengenommen.`, {
      x: marginLeft, y, size: 9, font: fontRegular, color: black,
    });
    y -= 14;
    ctx.page.drawText(`Datum: ${formatDateForPDF(invoice.date)}`, {
      x: marginLeft, y, size: 9, font: fontRegular, color: black,
    });
    y -= 20;
  } else {
    // Überweisung: Bankblock + ggf. QR braucht zusammenhängend ca. 110 px
    const bankInfo = [
      settings.company.accountHolder ? `Kontoinhaber: ${settings.company.accountHolder}` : '',
      settings.company.bankName ? `Bank: ${settings.company.bankName}` : '',
      settings.company.iban ? `IBAN: ${settings.company.iban}` : '',
      settings.company.bic ? `BIC: ${settings.company.bic}` : '',
    ].filter(Boolean);

    const bankBlockHeight = 30 + bankInfo.length * 14 + (qrData ? 90 : 0);
    ensureSpace(bankBlockHeight);

    const paymentText = `Bitte überweisen Sie den Betrag von ${formatCurrencyPDF(totals.brutto)} bis zum ${formatDateForPDF(addDays(invoice.date, invoice.dueDays || 14))} auf folgendes Konto:`;
    ctx.page.drawText(paymentText, {
      x: marginLeft, y, size: 9, font: fontRegular, color: black,
    });
    y -= 20;

    if (bankInfo.length > 0) {
      // QR-Code rechts neben den Bankdaten
      let qrSize = 0;
      if (qrData) {
        try {
          const qrImage = await doc.embedPng(Uint8Array.from(atob(qrData), c => c.charCodeAt(0)));
          qrSize = 80;
          const qrX = width - marginRight - qrSize;
          const qrY = y - qrSize + 14;
          ctx.page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
          const qrLabel = 'Scan to Pay';
          const qrLabelW = fontRegular.widthOfTextAtSize(qrLabel, 7);
          ctx.page.drawText(qrLabel, {
            x: qrX + (qrSize - qrLabelW) / 2,
            y: qrY - 10,
            size: 7, font: fontRegular, color: gray,
          });
        } catch (e) {
          console.warn('QR-Code-Embed-Fehler:', e);
          qrSize = 0;
        }
      }

      for (const line of bankInfo) {
        ctx.page.drawText(line, {
          x: marginLeft, y, size: 9, font: fontRegular, color: black,
        });
        y -= 14;
      }

      if (qrSize > 0 && bankInfo.length * 14 < qrSize) {
        y -= (qrSize - bankInfo.length * 14) + 10;
      }
    }
  }

  // =====================
  // Digitale Unterschrift
  // =====================
  if (signatureData && signatureData.data) {
    ensureSpace(80);
    try {
      let sigImage;
      if (signatureData.mimeType.includes('png')) {
        sigImage = await doc.embedPng(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      } else if (signatureData.mimeType.includes('jpeg') || signatureData.mimeType.includes('jpg')) {
        sigImage = await doc.embedJpg(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      }
      if (sigImage) {
        const dims = sigImage.scale(1);
        const maxH = 40;
        const maxW = 150;
        const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
        y -= 10;
        ctx.page.drawImage(sigImage, { x: marginLeft, y: y - dims.height * scale, width: dims.width * scale, height: dims.height * scale });
        y -= dims.height * scale + 4;
        ctx.page.drawLine({ start: { x: marginLeft, y }, end: { x: marginLeft + 150, y }, thickness: 0.5, color: lightGray });
        y -= 10;
        ctx.page.drawText(settings.company.name || '', { x: marginLeft, y, size: 7, font: fontRegular, color: gray });
        y -= 16;
      }
    } catch (e) { console.warn('Unterschrift-Embed-Fehler:', e); }
  }

  // =====================
  // Fußzeile + Seitenzahl AUF JEDER SEITE
  // =====================
  const footerY = 30;
  const footerParts = [
    settings.company.name,
    settings.company.taxNumber ? `St.Nr.: ${settings.company.taxNumber}` : '',
    settings.company.vatId ? `USt-IdNr.: ${settings.company.vatId}` : '',
  ].filter(Boolean);
  const footerText = footerParts.join('  ·  ');
  const footerWidth = fontRegular.widthOfTextAtSize(footerText, 7);
  const totalPages = ctx.pages.length;

  for (let i = 0; i < ctx.pages.length; i++) {
    const p = ctx.pages[i];
    p.drawLine({
      start: { x: marginLeft, y: footerY + 12 },
      end: { x: width - marginRight, y: footerY + 12 },
      thickness: 0.5,
      color: lightGray,
    });
    p.drawText(footerText, {
      x: (width - footerWidth) / 2,
      y: footerY,
      size: 7, font: fontRegular, color: gray,
    });
    if (totalPages > 1) {
      const pageLabel = `Seite ${i + 1} von ${totalPages}`;
      const labelW = fontRegular.widthOfTextAtSize(pageLabel, 7);
      p.drawText(pageLabel, {
        x: width - marginRight - labelW,
        y: footerY + 18,
        size: 7, font: fontRegular, color: gray,
      });
    }
  }

  return await doc.save();
}

// --- PDF Helpers ---
function drawSumLine(page, label, value, labelX, valueRight, y, labelFont, valueFont, size, labelColor, valueColor) {
  page.drawText(label, {
    x: labelX,
    y,
    size,
    font: labelFont,
    color: labelColor,
  });

  const vw = valueFont.widthOfTextAtSize(value, size);
  page.drawText(value, {
    x: valueRight - vw,
    y,
    size,
    font: valueFont,
    color: valueColor,
  });
}

function formatCurrencyPDF(amount) {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' €';
}

function formatNumber(num) {
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace('.', ',');
}

function formatDateForPDF(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}


// =============================================
// Zuwendungsbestätigung (Spendenquittung) PDF
// =============================================

function numberToWordsDE(num) {
  const ones = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
    'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const tens = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

  if (num === 0) return 'null';
  if (num < 0) return 'minus ' + numberToWordsDE(-num);

  let words = '';
  if (num >= 1000000) {
    const millions = Math.floor(num / 1000000);
    words += (millions === 1 ? 'eine Million ' : numberToWordsDE(millions) + ' Millionen ');
    num %= 1000000;
  }
  if (num >= 1000) {
    const thousands = Math.floor(num / 1000);
    words += (thousands === 1 ? 'eintausend' : numberToWordsDE(thousands) + 'tausend');
    num %= 1000;
  }
  if (num >= 100) {
    words += ones[Math.floor(num / 100)] + 'hundert';
    num %= 100;
  }
  if (num >= 20) {
    const o = num % 10;
    if (o > 0) words += ones[o] + 'und';
    words += tens[Math.floor(num / 10)];
  } else if (num > 0) {
    words += ones[num];
  }

  return words.trim();
}

function amountToWordsDE(amount) {
  const euros = Math.floor(amount);
  const cents = Math.round((amount - euros) * 100);
  let result = numberToWordsDE(euros);
  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);
  if (cents > 0) {
    result += ' Euro und ' + numberToWordsDE(cents) + ' Cent';
  } else {
    result += ' Euro';
  }
  return '- ' + result + ' -';
}

async function generateDonationReceiptPDF({ donations, settings, logoData, signatureData, isSammel = false, year }) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.35, 0.35, 0.4);
  const lightGray = rgb(0.85, 0.85, 0.88);

  const ml = 50; // margin left
  const mr = 50;
  const cw = width - ml - mr; // content width
  let y = height - 50;

  // --- Helper ---
  function drawText(text, x, yPos, opts = {}) {
    const font = opts.bold ? fontBold : fontRegular;
    const size = opts.size || 9;
    const color = opts.color || black;
    page.drawText(text || '', { x, y: yPos, size, font, color });
    return yPos;
  }

  function drawLine(x1, yPos, x2) {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness: 0.5, color: lightGray });
  }

  // Get company/org info
  const company = settings.company || {};
  const orgName = company.name || 'Verein';

  // Total amount
  const totalAmount = donations.reduce((s, d) => s + (d.amount || 0), 0);

  // Donor info (from first donation)
  const donor = donations[0] || {};
  const donorName = donor.donorName || '';
  const donorAddress = [donor.donorAddress, [donor.donorZip, donor.donorCity].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  // =====================
  // HEADER — Logo + Vereinsdaten
  // =====================
  if (logoData && logoData.data) {
    try {
      let logoImage;
      if (logoData.mimeType.includes('png')) {
        logoImage = await doc.embedPng(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      } else if (logoData.mimeType.includes('jpeg') || logoData.mimeType.includes('jpg')) {
        logoImage = await doc.embedJpg(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      }
      if (logoImage) {
        const dims = logoImage.scale(1);
        const maxH = 50;
        const maxW = 120;
        const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
        page.drawImage(logoImage, { x: ml, y: y - dims.height * scale, width: dims.width * scale, height: dims.height * scale });
      }
    } catch (e) { console.warn('Logo embed error:', e); }
  }

  // Vereinsname rechts
  const orgNameWidth = fontBold.widthOfTextAtSize(orgName, 11);
  drawText(orgName, width - mr - orgNameWidth, y - 10, { bold: true, size: 11 });

  // Vereinsadresse rechts
  const addressParts = [company.address, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean);
  let addrY = y - 24;
  for (const part of addressParts) {
    const partWidth = fontRegular.widthOfTextAtSize(part, 8);
    drawText(part, width - mr - partWidth, addrY, { size: 8, color: gray });
    addrY -= 11;
  }

  y -= 80;

  // =====================
  // TITLE
  // =====================
  const titleText = isSammel
    ? 'Sammelbestätigung über Geldzuwendungen'
    : (donor.type === 'sach' ? 'Bestätigung über Sachzuwendungen' : 'Bestätigung über Geldzuwendungen');

  const titleWidth = fontBold.widthOfTextAtSize(titleText, 13);
  drawText(titleText, (width - titleWidth) / 2, y, { bold: true, size: 13 });
  y -= 14;

  const subtitleText = 'im Sinne des § 10b des Einkommensteuergesetzes';
  const subtitleWidth = fontRegular.widthOfTextAtSize(subtitleText, 9);
  drawText(subtitleText, (width - subtitleWidth) / 2, y, { size: 9, color: gray });
  y -= 10;

  const subtitle2 = 'an eine der in § 5 Abs. 1 Nr. 9 des KStG bezeichneten Körperschaften';
  const subtitle2Width = fontRegular.widthOfTextAtSize(subtitle2, 8);
  drawText(subtitle2, (width - subtitle2Width) / 2, y, { size: 8, color: gray });
  y -= 28;

  // =====================
  // SPENDER + BETRAG
  // =====================
  drawText('Name und Anschrift des Zuwendenden:', ml, y, { size: 8, color: gray });
  y -= 14;
  drawText(donorName, ml, y, { bold: true, size: 10 });
  y -= 13;
  if (donorAddress) {
    drawText(donorAddress, ml, y, { size: 9 });
    y -= 18;
  } else {
    y -= 5;
  }

  // Betrag
  drawLine(ml, y, width - mr);
  y -= 16;

  if (isSammel) {
    drawText('Gesamtsumme der Zuwendungen:', ml, y, { size: 8, color: gray });
    y -= 14;
    drawText(formatCurrency(totalAmount), ml, y, { bold: true, size: 14 });

    const wordsText = amountToWordsDE(totalAmount);
    const wordsWidth = fontRegular.widthOfTextAtSize(wordsText, 9);
    drawText(wordsText, ml + 130, y + 1, { size: 9, color: gray });
    y -= 16;

    const periodText = `Zeitraum der Sammelbestätigung: 01.01.${year} – 31.12.${year}`;
    drawText(periodText, ml, y, { size: 9 });
    y -= 20;
  } else {
    drawText('Betrag der Zuwendung:', ml, y, { size: 8, color: gray });
    drawText('Tag der Zuwendung:', ml + 280, y, { size: 8, color: gray });
    y -= 14;
    drawText(formatCurrency(totalAmount), ml, y, { bold: true, size: 14 });
    drawText(formatDate(donor.date), ml + 280, y, { size: 10 });
    y -= 16;

    const wordsText = amountToWordsDE(totalAmount);
    drawText(wordsText, ml, y, { size: 9, color: gray });
    y -= 20;
  }

  drawLine(ml, y, width - mr);
  y -= 16;

  // =====================
  // ZUWENDUNGSEMPFÄNGER
  // =====================
  drawText('Zuwendungsempfänger:', ml, y, { size: 8, color: gray });
  y -= 14;
  drawText(orgName, ml, y, { bold: true, size: 10 });
  y -= 13;
  const empfAddress = [company.address, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (empfAddress) {
    drawText(empfAddress, ml, y, { size: 9 });
    y -= 18;
  }

  if (settings.taxNumber) {
    drawText('Steuernummer: ' + settings.taxNumber, ml, y, { size: 8, color: gray });
    y -= 12;
  }
  if (settings.vatId) {
    drawText('Finanzamt / USt-IdNr.: ' + settings.vatId, ml, y, { size: 8, color: gray });
    y -= 12;
  }

  y -= 8;
  drawLine(ml, y, width - mr);
  y -= 18;

  // =====================
  // RECHTLICHE HINWEISE
  // =====================
  const legalTexts = [
    'Es wird bestätigt, dass die Zuwendung nur zur Förderung ' +
    (settings.vereinszweck || 'gemeinnütziger, mildtätiger und religiöser Zwecke') +
    ' (im Sinne der §§ 52 ff. AO) verwendet wird.',
    '',
    donor.type === 'sach'
      ? 'Es handelt sich um den Verzicht auf die Erstattung von Aufwendungen: Nein.'
      : 'Es handelt sich nicht um den Verzicht auf die Erstattung von Aufwendungen.',
    '',
    'Der Zuwendungsempfänger ist durch den Freistellungsbescheid des Finanzamts ' +
    (settings.finanzamt || '_______________') + ', Steuernummer ' +
    (settings.taxNumber || '_______________') + ', vom ' +
    (settings.freistellungsDatum || '_______________') +
    ' für den letzten Veranlagungszeitraum ' +
    (settings.veranlagungszeitraum || '_______________') +
    ' nach § 5 Abs. 1 Nr. 9 des KStG von der Körperschaftsteuer befreit.',
  ];

  for (const text of legalTexts) {
    if (!text) { y -= 4; continue; }
    const lines = wrapText(text, fontRegular, 8.5, cw);
    for (const line of lines) {
      drawText(line, ml, y, { size: 8.5 });
      y -= 12;
    }
  }

  y -= 8;

  // =====================
  // SAMMELBESTÄTIGUNG: Einzelaufstellung
  // =====================
  if (isSammel && donations.length > 0) {
    drawLine(ml, y, width - mr);
    y -= 16;
    drawText('Aufstellung der einzelnen Zuwendungen:', ml, y, { bold: true, size: 9 });
    y -= 18;

    // Table header
    drawText('Datum', ml, y, { bold: true, size: 8 });
    drawText('Art', ml + 80, y, { bold: true, size: 8 });
    drawText('Zweck', ml + 160, y, { bold: true, size: 8 });
    const betragHeader = 'Betrag';
    const betragHW = fontBold.widthOfTextAtSize(betragHeader, 8);
    drawText(betragHeader, width - mr - betragHW, y, { bold: true, size: 8 });
    y -= 4;
    drawLine(ml, y, width - mr);
    y -= 12;

    // Sort by date
    const sortedDonations = [...donations].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const d of sortedDonations) {
      if (y < 100) {
        // Would need new page for very long lists — keep simple for now
        drawText('... (weitere Einträge)', ml, y, { size: 8, color: gray });
        y -= 12;
        break;
      }
      drawText(formatDate(d.date), ml, y, { size: 8 });
      drawText(d.type === 'sach' ? 'Sachspende' : 'Geldspende', ml + 80, y, { size: 8 });
      drawText((d.purpose || '').substring(0, 40), ml + 160, y, { size: 8 });
      const amtStr = formatCurrency(d.amount);
      const amtW = fontRegular.widthOfTextAtSize(amtStr, 8);
      drawText(amtStr, width - mr - amtW, y, { size: 8 });
      y -= 14;
    }

    // Sum line
    drawLine(ml, y + 4, width - mr);
    y -= 10;
    drawText('Gesamt:', ml + 160, y, { bold: true, size: 9 });
    const totalStr = formatCurrency(totalAmount);
    const totalW = fontBold.widthOfTextAtSize(totalStr, 9);
    drawText(totalStr, width - mr - totalW, y, { bold: true, size: 9 });
    y -= 20;
  }

  // =====================
  // HINWEISTEXT
  // =====================
  y -= 4;
  const hinweis = 'Es wird bestätigt, dass es sich bei den Zuwendungen um den Verzicht auf die Erstattung ' +
    'von Aufwendungen handelt: Nein.';
  // Small legal footnote
  const footnote = 'Wer vorsätzlich oder grob fahrlässig eine unrichtige Zuwendungsbestätigung erstellt oder veranlasst, ' +
    'dass Zuwendungen nicht zu den in der Zuwendungsbestätigung angegebenen steuerbegünstigten Zwecken ' +
    'verwendet werden, haftet für die entgangene Steuer (§ 10b Abs. 4 EStG, § 9 Abs. 3 KStG, § 9 Nr. 5 GewStG).';

  const fnLines = wrapText(footnote, fontRegular, 7, cw);
  for (const line of fnLines) {
    drawText(line, ml, y, { size: 7, color: gray });
    y -= 10;
  }

  // =====================
  // UNTERSCHRIFT
  // =====================
  y -= 20;
  drawText(company.city || '_______________', ml, y, { size: 9 });
  drawText(', den ' + new Date().toLocaleDateString('de-DE'), ml + fontRegular.widthOfTextAtSize(company.city || '_______________', 9) + 2, y, { size: 9 });
  y -= 14;

  // Digitale Unterschrift einbetten
  if (signatureData && signatureData.data) {
    try {
      let sigImage;
      if (signatureData.mimeType.includes('png')) {
        sigImage = await doc.embedPng(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      } else if (signatureData.mimeType.includes('jpeg') || signatureData.mimeType.includes('jpg')) {
        sigImage = await doc.embedJpg(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      }
      if (sigImage) {
        const dims = sigImage.scale(1);
        const maxH = 45;
        const maxW = 160;
        const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
        page.drawImage(sigImage, { x: ml, y: y - dims.height * scale, width: dims.width * scale, height: dims.height * scale });
        y -= dims.height * scale + 4;
      }
    } catch (e) { console.warn('Unterschrift-Embed-Fehler:', e); }
  } else {
    y -= 16;
  }

  drawLine(ml, y, ml + 200);
  y -= 12;
  drawText('Unterschrift des Zuwendungsempfängers', ml, y, { size: 7, color: gray });

  return await doc.save();
}

// ==========================
// BRIEFPAPIER / LETTERHEAD
// ==========================
async function generateLetterPDF({ settings, logoData, signatureData, recipient, subject, date, body }) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.4, 0.4, 0.45);
  const lightGray = rgb(0.85, 0.85, 0.88);
  const accent = rgb(0, 0.44, 0.89);

  const marginLeft = 50;
  const marginRight = 50;
  const contentWidth = width - marginLeft - marginRight;

  let y = height - 50;

  // =====================
  // HEADER — Logo + Firmendaten
  // =====================
  const headerTop = y;

  // Logo (links)
  if (logoData && logoData.data) {
    try {
      let logoImage;
      if (logoData.mimeType.includes('png')) {
        logoImage = await doc.embedPng(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      } else if (logoData.mimeType.includes('jpeg') || logoData.mimeType.includes('jpg')) {
        logoImage = await doc.embedJpg(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      }
      if (logoImage) {
        const logoDims = logoImage.scale(1);
        const maxH = 60, maxW = 150;
        const scale = Math.min(maxW / logoDims.width, maxH / logoDims.height, 1);
        const w = logoDims.width * scale;
        const h = logoDims.height * scale;
        page.drawImage(logoImage, { x: marginLeft, y: headerTop - h, width: w, height: h });
      }
    } catch (e) { console.error('Logo-Embed-Fehler:', e); }
  }

  // Firmendaten (rechts oben)
  const companyX = width - marginRight;
  const companyLines = [
    { text: settings.company.name || '', font: fontBold, size: 12 },
    { text: settings.company.address || '', font: fontRegular, size: 9 },
    { text: `${settings.company.zip || ''} ${settings.company.city || ''}`.trim(), font: fontRegular, size: 9 },
    { text: settings.company.phone ? `Tel: ${settings.company.phone}` : '', font: fontRegular, size: 9 },
    { text: settings.company.email || '', font: fontRegular, size: 9 },
    { text: settings.company.website || '', font: fontRegular, size: 9 },
  ].filter(l => l.text);

  let companyY = headerTop;
  for (const line of companyLines) {
    const tw = line.font.widthOfTextAtSize(line.text, line.size);
    page.drawText(line.text, {
      x: companyX - tw,
      y: companyY - line.size,
      size: line.size,
      font: line.font,
      color: line === companyLines[0] ? black : gray,
    });
    companyY -= line.size + 4;
  }

  y = Math.min(companyY, headerTop - 70) - 20;

  // =====================
  // Absenderzeile (klein, unterstrichen)
  // =====================
  const senderLine = [
    settings.company.name,
    settings.company.address,
    `${settings.company.zip || ''} ${settings.company.city || ''}`.trim()
  ].filter(Boolean).join(' · ');

  page.drawText(senderLine, { x: marginLeft, y, size: 7, font: fontRegular, color: gray });
  y -= 3;
  page.drawLine({ start: { x: marginLeft, y }, end: { x: marginLeft + 250, y }, thickness: 0.5, color: lightGray });
  y -= 18;

  // =====================
  // EMPFÄNGER
  // =====================
  if (recipient) {
    const recipientLines = recipient.split('\n').filter(l => l.trim());
    for (const line of recipientLines) {
      page.drawText(line.trim(), { x: marginLeft, y, size: 10, font: fontRegular, color: black });
      y -= 14;
    }
  }

  y -= 20;

  // =====================
  // DATUM (rechts)
  // =====================
  if (date) {
    const dateText = date;
    const dateWidth = fontRegular.widthOfTextAtSize(dateText, 10);
    page.drawText(dateText, { x: width - marginRight - dateWidth, y, size: 10, font: fontRegular, color: gray });
    y -= 30;
  }

  // =====================
  // BETREFF
  // =====================
  if (subject) {
    page.drawText(subject, { x: marginLeft, y, size: 12, font: fontBold, color: black });
    y -= 28;
  }

  // =====================
  // TEXTKÖRPER
  // =====================
  if (body) {
    const lines = body.split('\n');
    const fontSize = 10;
    const lineHeight = 16;
    const maxWidth = contentWidth;

    for (const rawLine of lines) {
      if (rawLine.trim() === '') {
        y -= lineHeight;
        if (y < 80) { /* Keine neue Seite für Briefpapier */ break; }
        continue;
      }

      // Zeilenumbruch bei langen Zeilen
      const words = rawLine.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = fontRegular.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          page.drawText(currentLine, { x: marginLeft, y, size: fontSize, font: fontRegular, color: black });
          y -= lineHeight;
          currentLine = word;
          if (y < 80) break;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine && y >= 80) {
        page.drawText(currentLine, { x: marginLeft, y, size: fontSize, font: fontRegular, color: black });
        y -= lineHeight;
      }

      if (y < 80) break;
    }
  }

  // =====================
  // UNTERSCHRIFT
  // =====================
  if (signatureData && signatureData.data) {
    y -= 10;
    try {
      let sigImage;
      if (signatureData.mimeType.includes('png')) {
        sigImage = await doc.embedPng(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      } else {
        sigImage = await doc.embedJpg(Uint8Array.from(atob(signatureData.data), c => c.charCodeAt(0)));
      }
      if (sigImage) {
        const dims = sigImage.scale(1);
        const maxH = 40, maxW = 120;
        const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
        page.drawImage(sigImage, { x: marginLeft, y: y - dims.height * scale, width: dims.width * scale, height: dims.height * scale });
        y -= dims.height * scale + 8;
      }
    } catch (e) { console.error('Signatur-Fehler:', e); }
  }

  // =====================
  // FUSSZEILE
  // =====================
  const footerY = 30;
  const footerParts = [
    settings.company.name,
    settings.company.iban ? `IBAN: ${settings.company.iban}` : '',
    settings.company.bankName ? `Bank: ${settings.company.bankName}` : '',
    settings.company.taxNumber ? `St.Nr.: ${settings.company.taxNumber}` : '',
  ].filter(Boolean);

  const footerText = footerParts.join('  ·  ');
  const footerWidth = fontRegular.widthOfTextAtSize(footerText, 7);

  page.drawLine({
    start: { x: marginLeft, y: footerY + 12 },
    end: { x: width - marginRight, y: footerY + 12 },
    thickness: 0.5, color: lightGray,
  });

  page.drawText(footerText, {
    x: (width - footerWidth) / 2,
    y: footerY,
    size: 7, font: fontRegular, color: gray,
  });

  return await doc.save();
}

// ==========================
// PROJEKT-REPORT PDF
// ==========================
async function generateProjectReportPDF({ project, stats, settings, logoData, getCustomer, categories, calculateInvoiceTotal }) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const A4 = [595.28, 841.89];

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.4, 0.4, 0.45);
  const lightGray = rgb(0.88, 0.88, 0.91);

  // Projekt-Farbe als RGB parsen
  const hex = (project.color || '#2563eb').replace('#', '');
  const projColor = rgb(
    parseInt(hex.substring(0, 2), 16) / 255,
    parseInt(hex.substring(2, 4), 16) / 255,
    parseInt(hex.substring(4, 6), 16) / 255,
  );

  const ml = 50, mr = 50;
  const footerReserve = 50;
  const ctx = { page: doc.addPage(A4), pages: [] };
  ctx.pages.push(ctx.page);
  const { width, height } = ctx.page.getSize();
  let y = height - 50;

  function newPage() {
    ctx.page = doc.addPage(A4);
    ctx.pages.push(ctx.page);
    y = height - 50;
  }
  function ensureSpace(needed) {
    if (y - needed < footerReserve) { newPage(); return true; }
    return false;
  }

  // === HEADER ===
  if (logoData && logoData.data) {
    try {
      let img;
      if (logoData.mimeType.includes('png')) img = await doc.embedPng(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      else img = await doc.embedJpg(Uint8Array.from(atob(logoData.data), c => c.charCodeAt(0)));
      if (img) {
        const d = img.scale(1);
        const s = Math.min(150 / d.width, 50 / d.height, 1);
        ctx.page.drawImage(img, { x: ml, y: y - d.height * s, width: d.width * s, height: d.height * s });
      }
    } catch (e) {}
  }
  // Org-Name rechts
  const orgName = (settings.company && settings.company.name) || '';
  if (orgName) {
    const tw = fontBold.widthOfTextAtSize(orgName, 11);
    ctx.page.drawText(orgName, { x: width - mr - tw, y: y - 14, size: 11, font: fontBold, color: black });
  }
  y -= 70;

  // === Farbiger Akzentstreifen + Projektname ===
  ctx.page.drawRectangle({ x: ml, y: y - 6, width: 4, height: 36, color: projColor });
  ctx.page.drawText('Projektbericht', { x: ml + 14, y: y + 14, size: 9, font: fontRegular, color: gray });
  ctx.page.drawText(project.name + (project.code ? `  (${project.code})` : ''), { x: ml + 14, y: y - 4, size: 18, font: fontBold, color: black });
  y -= 50;

  // === Meta-Infos ===
  const metaLines = [];
  if (project.startDate || project.endDate) {
    const s = project.startDate ? new Date(project.startDate).toLocaleDateString('de-DE') : '—';
    const e = project.endDate ? new Date(project.endDate).toLocaleDateString('de-DE') : 'offen';
    metaLines.push(`Zeitraum: ${s} bis ${e}`);
  }
  metaLines.push(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`);
  if (project.description) metaLines.push(project.description);
  for (const line of metaLines) {
    ctx.page.drawText(line, { x: ml, y, size: 9, font: fontRegular, color: gray });
    y -= 13;
  }
  y -= 10;

  // === Summenbox ===
  const boxH = 60;
  ensureSpace(boxH + 20);
  ctx.page.drawRectangle({ x: ml, y: y - boxH, width: width - ml - mr, height: boxH, color: rgb(0.97, 0.97, 0.98) });
  const colW = (width - ml - mr) / 3;
  const labels = ['Einnahmen', 'Ausgaben', 'Saldo'];
  const values = [stats.income, stats.expenses, stats.balance];
  const colors = [rgb(0.13, 0.65, 0.36), rgb(0.86, 0.21, 0.27), stats.balance >= 0 ? rgb(0.13, 0.65, 0.36) : rgb(0.86, 0.21, 0.27)];
  for (let i = 0; i < 3; i++) {
    const cx = ml + colW * i + colW / 2;
    const lbl = labels[i];
    const lblW = fontRegular.widthOfTextAtSize(lbl, 9);
    ctx.page.drawText(lbl, { x: cx - lblW / 2, y: y - 18, size: 9, font: fontRegular, color: gray });
    const val = formatCurrencyPDF(values[i]);
    const valW = fontBold.widthOfTextAtSize(val, 16);
    ctx.page.drawText(val, { x: cx - valW / 2, y: y - 42, size: 16, font: fontBold, color: colors[i] });
  }
  y -= boxH + 20;

  // === Helper: Table renderer mit Pagination ===
  function drawSectionTitle(title) {
    ensureSpace(30);
    ctx.page.drawText(title, { x: ml, y, size: 12, font: fontBold, color: black });
    y -= 8;
    ctx.page.drawLine({ start: { x: ml, y }, end: { x: width - mr, y }, thickness: 0.8, color: projColor });
    y -= 16;
  }

  function drawTableHeader(cols) {
    ensureSpace(24);
    ctx.page.drawRectangle({ x: ml, y: y - 14, width: width - ml - mr, height: 18, color: rgb(0.94, 0.94, 0.96) });
    let cx = ml + 6;
    for (const col of cols) {
      const tw = fontBold.widthOfTextAtSize(col.label, 8);
      const tx = col.align === 'right' ? cx + col.width - tw - 6 : cx;
      ctx.page.drawText(col.label, { x: tx, y: y - 8, size: 8, font: fontBold, color: gray });
      cx += col.width;
    }
    y -= 22;
  }

  function drawTableRow(cols, row, idx) {
    if (idx % 2 === 1) {
      ctx.page.drawRectangle({ x: ml, y: y - 12, width: width - ml - mr, height: 18, color: rgb(0.985, 0.985, 0.99) });
    }
    let cx = ml + 6;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      let text = row[c] == null ? '' : String(row[c]);
      const maxW = col.width - 12;
      while (fontRegular.widthOfTextAtSize(text, 9) > maxW && text.length > 3) text = text.slice(0, -4) + '...';
      const tw = fontRegular.widthOfTextAtSize(text, 9);
      const tx = col.align === 'right' ? cx + col.width - tw - 6 : cx;
      ctx.page.drawText(text, { x: tx, y: y - 4, size: 9, font: fontRegular, color: black });
      cx += col.width;
    }
    y -= 18;
  }

  // === Einnahmen-Tabelle ===
  drawSectionTitle(`Einnahmen — ${stats.invoiceCount} Rechnung(en)`);
  if (stats.invoices.length === 0) {
    ctx.page.drawText('Keine Rechnungen diesem Projekt zugeordnet.', { x: ml, y, size: 9, font: fontRegular, color: gray });
    y -= 20;
  } else {
    const totalW = width - ml - mr;
    const invCols = [
      { label: 'Datum', width: totalW * 0.13, align: 'left' },
      { label: 'Nummer', width: totalW * 0.17, align: 'left' },
      { label: 'Kunde', width: totalW * 0.40, align: 'left' },
      { label: 'Netto', width: totalW * 0.10, align: 'right' },
      { label: 'MwSt', width: totalW * 0.08, align: 'right' },
      { label: 'Brutto', width: totalW * 0.12, align: 'right' },
    ];
    drawTableHeader(invCols);
    const sortedInv = [...stats.invoices].sort((a, b) => new Date(a.date) - new Date(b.date));
    let idx = 0;
    for (const inv of sortedInv) {
      if (y - 18 < footerReserve) { newPage(); drawTableHeader(invCols); }
      const c = getCustomer ? getCustomer(inv.customerId) : null;
      const t = calculateInvoiceTotal(inv);
      const sign = inv.type === 'gutschrift' ? -1 : 1;
      drawTableRow(invCols, [
        formatDateForPDF(inv.date),
        inv.number || '',
        (c && c.name) || '—',
        formatCurrencyPDF(sign * t.netto),
        formatCurrencyPDF(sign * t.mwst),
        formatCurrencyPDF(sign * t.brutto),
      ], idx++);
    }
    // Summe
    y -= 4;
    ctx.page.drawLine({ start: { x: ml, y }, end: { x: width - mr, y }, thickness: 0.5, color: lightGray });
    y -= 14;
    const sumLabel = 'Summe Einnahmen:';
    const sumVal = formatCurrencyPDF(stats.income);
    const sumValW = fontBold.widthOfTextAtSize(sumVal, 10);
    ctx.page.drawText(sumLabel, { x: width - mr - 200, y, size: 10, font: fontBold, color: black });
    ctx.page.drawText(sumVal, { x: width - mr - sumValW, y, size: 10, font: fontBold, color: rgb(0.13, 0.65, 0.36) });
    y -= 24;
  }

  // === Ausgaben-Tabelle ===
  drawSectionTitle(`Ausgaben — ${stats.expenseCount} Buchung(en)`);
  if (stats.expenseEntries.length === 0) {
    ctx.page.drawText('Keine Ausgaben diesem Projekt zugeordnet.', { x: ml, y, size: 9, font: fontRegular, color: gray });
    y -= 20;
  } else {
    const totalW = width - ml - mr;
    const expCols = [
      { label: 'Datum', width: totalW * 0.13, align: 'left' },
      { label: 'Beschreibung', width: totalW * 0.45, align: 'left' },
      { label: 'Kategorie', width: totalW * 0.27, align: 'left' },
      { label: 'Betrag', width: totalW * 0.15, align: 'right' },
    ];
    drawTableHeader(expCols);
    const sortedExp = [...stats.expenseEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
    let idx = 0;
    for (const e of sortedExp) {
      if (y - 18 < footerReserve) { newPage(); drawTableHeader(expCols); }
      const cat = (categories && categories[e.category]) || { label: '', icon: '' };
      drawTableRow(expCols, [
        formatDateForPDF(e.date),
        e.description || '',
        `${cat.icon || ''} ${cat.label || ''}`.trim(),
        `-${formatCurrencyPDF(e.amount || 0)}`,
      ], idx++);
    }
    y -= 4;
    ctx.page.drawLine({ start: { x: ml, y }, end: { x: width - mr, y }, thickness: 0.5, color: lightGray });
    y -= 14;
    const sumVal = '-' + formatCurrencyPDF(stats.expenses);
    const sumValW = fontBold.widthOfTextAtSize(sumVal, 10);
    ctx.page.drawText('Summe Ausgaben:', { x: width - mr - 200, y, size: 10, font: fontBold, color: black });
    ctx.page.drawText(sumVal, { x: width - mr - sumValW, y, size: 10, font: fontBold, color: rgb(0.86, 0.21, 0.27) });
    y -= 28;
  }

  // === Saldo ===
  ensureSpace(40);
  ctx.page.drawLine({ start: { x: ml, y }, end: { x: width - mr, y }, thickness: 1.5, color: black });
  y -= 18;
  const balVal = formatCurrencyPDF(stats.balance);
  const balW = fontBold.widthOfTextAtSize(balVal, 14);
  ctx.page.drawText('Saldo:', { x: width - mr - 200, y, size: 13, font: fontBold, color: black });
  ctx.page.drawText(balVal, { x: width - mr - balW, y, size: 14, font: fontBold, color: stats.balance >= 0 ? rgb(0.13, 0.65, 0.36) : rgb(0.86, 0.21, 0.27) });

  // === Footer auf jeder Seite ===
  const total = ctx.pages.length;
  for (let i = 0; i < total; i++) {
    const p = ctx.pages[i];
    const fy = 30;
    p.drawLine({ start: { x: ml, y: fy + 12 }, end: { x: width - mr, y: fy + 12 }, thickness: 0.5, color: lightGray });
    const ft = `${orgName} · Projektbericht ${project.name}`;
    const ftW = fontRegular.widthOfTextAtSize(ft, 7);
    p.drawText(ft, { x: (width - ftW) / 2, y: fy, size: 7, font: fontRegular, color: gray });
    if (total > 1) {
      const lab = `Seite ${i + 1} von ${total}`;
      const lw = fontRegular.widthOfTextAtSize(lab, 7);
      p.drawText(lab, { x: width - mr - lw, y: fy + 18, size: 7, font: fontRegular, color: gray });
    }
  }

  return await doc.save();
}
