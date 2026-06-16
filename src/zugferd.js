// ZUGFeRD / Factur-X XML-Generator
// Profil: EN16931 (BASIC + Erweiterungen, EU-Norm — Standardprofil ab 2025)
//
// Erzeugt eine CII-XML (Cross Industry Invoice) nach UN/CEFACT,
// die in die PDF eingebettet werden kann (Factur-X 1.0).
//
// Specs:
//   https://www.ferd-net.de/standards/zugferd
//   https://fnfe-mpe.org/factur-x/

function xmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtAmount(n) {
  // ZUGFeRD verlangt Punkt als Dezimaltrenner, 2 Nachkommastellen
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function fmtQty(n) {
  // Mengen mit bis zu 4 Nachkommastellen
  const v = Number(n) || 0;
  return v.toFixed(4).replace(/\.?0+$/, '');
}

function fmtDate(dateStr) {
  // ZUGFeRD-Datum: YYYYMMDD (Format-Code 102)
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function addDaysISO(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + (days || 14));
  return d.toISOString().split('T')[0];
}

/**
 * Generiert die Factur-X XML für eine Rechnung.
 * @param {object} opts
 * @param {object} opts.invoice - Rechnungsobjekt
 * @param {object} opts.settings - App-Settings (mit settings.company)
 * @param {object} opts.customer - Kundenobjekt
 * @param {object} opts.totals - Ergebnis aus calculateInvoiceTotal()
 * @returns {string} XML-Inhalt
 */
function generateFacturXXML({ invoice, settings, customer, totals }) {
  const company = settings.company || {};
  const isKlein = totals.taxMode === 'kleinunternehmer';
  const isGutschrift = invoice.type === 'gutschrift';
  // BT-3 Type-Code: 380 = Rechnung, 381 = Gutschrift/Stornorechnung
  const typeCode = isGutschrift ? '381' : '380';

  // ID-Schemes: SchemeID gem. ISO/IEC 6523. Für DE-Steuernr: '0204' (manche nutzen es nicht).
  // Wir verwenden einfache Tax-Registrations ohne Scheme.

  const issueDate = fmtDate(invoice.date);
  const dueDate = fmtDate(addDaysISO(invoice.date, invoice.dueDays || 14));

  // Positionen (BG-25)
  const items = invoice.items || [];
  const linesXml = items.map((item, i) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const lineNet = qty * price;
    const rate = isKlein ? 0 : Number(item.taxRate != null ? item.taxRate : 19);
    const taxCategory = isKlein ? 'E' : 'S'; // E=Exempt, S=Standard
    return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${i + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${xmlEscape(item.description || '')}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${fmtAmount(price)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${fmtQty(qty)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${taxCategory}</ram:CategoryCode>
          <ram:RateApplicablePercent>${rate.toFixed(2)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${fmtAmount(lineNet)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');

  // MwSt-Aufschlüsselung (BG-23)
  let taxBreakdownXml = '';
  if (isKlein) {
    taxBreakdownXml = `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>0.00</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:ExemptionReason>Gem. §19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmer).</ram:ExemptionReason>
        <ram:BasisAmount>${fmtAmount(totals.netto)}</ram:BasisAmount>
        <ram:CategoryCode>E</ram:CategoryCode>
        <ram:ExemptionReasonCode>VATEX-EU-D</ram:ExemptionReasonCode>
        <ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
  } else {
    const groups = totals.taxGroups || {};
    taxBreakdownXml = Object.keys(groups)
      .sort((a, b) => Number(a) - Number(b))
      .map(rate => {
        const g = groups[rate];
        const taxAmount = g.mwst != null ? g.mwst : (g.netto * Number(rate) / 100);
        const basis = g.netto != null ? g.netto : 0;
        return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${fmtAmount(taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${fmtAmount(basis)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${Number(rate).toFixed(2)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
      }).join('');
  }

  // Verkäufer-Steuerregistrierung
  let sellerTaxRegXml = '';
  if (company.vatId) {
    sellerTaxRegXml += `\n          <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEscape(company.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`;
  }
  if (company.taxNumber) {
    sellerTaxRegXml += `\n          <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${xmlEscape(company.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`;
  }

  // Bankverbindung (BG-17)
  let paymentMeansXml = '';
  if (invoice.paymentMethod === 'bar') {
    paymentMeansXml = `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>10</ram:TypeCode>
        <ram:Information>Bar bezahlt</ram:Information>
      </ram:SpecifiedTradeSettlementPaymentMeans>`;
  } else if (company.iban) {
    paymentMeansXml = `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:Information>SEPA-Überweisung</ram:Information>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${xmlEscape(company.iban.replace(/\s/g, ''))}</ram:IBANID>
          ${company.accountHolder ? `<ram:AccountName>${xmlEscape(company.accountHolder)}</ram:AccountName>` : ''}
        </ram:PayeePartyCreditorFinancialAccount>
        ${company.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xmlEscape(company.bic.replace(/\s/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>`;
  }

  const cust = customer || {};
  const buyerCountry = cust.country || 'DE';
  const sellerCountry = company.country || 'DE';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xmlEscape(invoice.number)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issueDate}</udt:DateTimeString>
    </ram:IssueDateTime>
    ${invoice.notes ? `<ram:IncludedNote><ram:Content>${xmlEscape(invoice.notes)}</ram:Content></ram:IncludedNote>` : ''}
    ${isKlein ? `<ram:IncludedNote><ram:Content>Gemäß §19 UStG wird keine Umsatzsteuer berechnet.</ram:Content><ram:SubjectCode>AAI</ram:SubjectCode></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${linesXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${xmlEscape(company.name || '')}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${xmlEscape(company.zip || '')}</ram:PostcodeCode>
          <ram:LineOne>${xmlEscape(company.address || '')}</ram:LineOne>
          <ram:CityName>${xmlEscape(company.city || '')}</ram:CityName>
          <ram:CountryID>${xmlEscape(sellerCountry)}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${company.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xmlEscape(company.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${sellerTaxRegXml}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${xmlEscape(cust.name || '')}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${xmlEscape(cust.zip || '')}</ram:PostcodeCode>
          <ram:LineOne>${xmlEscape(cust.street || '')}</ram:LineOne>
          <ram:CityName>${xmlEscape(cust.city || '')}</ram:CityName>
          <ram:CountryID>${xmlEscape(buyerCountry)}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${cust.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xmlEscape(cust.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${issueDate}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${paymentMeansXml}
${taxBreakdownXml}
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>Zahlbar bis ${invoice.date ? new Date(addDaysISO(invoice.date, invoice.dueDays || 14)).toLocaleDateString('de-DE') : ''}</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${fmtAmount(totals.netto)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${fmtAmount(totals.netto)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${fmtAmount(totals.mwst)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${fmtAmount(totals.brutto)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${fmtAmount(totals.brutto)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

  return xml;
}

// Browser-global verfügbar machen (kein Module-System im Renderer)
if (typeof window !== 'undefined') {
  window.generateFacturXXML = generateFacturXXML;
}
