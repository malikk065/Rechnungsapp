// --- App State ---
let currentInvoiceItems = [];
let editingInvoiceId = null;

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  // Plattform-Klasse setzen für CSS
  document.body.parentElement.classList.add(`platform-${navigator.platform.includes('Mac') ? 'darwin' : 'win32'}`);
  await store.loadSettings();
  await store.loadCustomers();
  await store.loadInvoices();

  setupNavigation();
  setupForms();
  renderDashboard();
  renderCustomersList();
  renderSettingsForm();
  updateInvoiceForm();
  updateNumberPreview();
});

// --- Navigation ---
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(`tab-${tabName}`);

  if (navItem) navItem.classList.add('active');
  if (tabContent) tabContent.classList.add('active');

  // Refresh data when switching tabs
  if (tabName === 'dashboard') renderDashboard();
  if (tabName === 'customers') renderCustomersList();
  if (tabName === 'new-invoice') updateInvoiceForm();
}

// --- Toast ---
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// --- Format helpers ---
function formatCurrency(amount) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE');
}

// ==========================
// DASHBOARD
// ==========================
function renderDashboard() {
  const invoices = store.invoices;
  const total = invoices.length;
  const open = invoices.filter((i) => i.status === 'offen').length;
  const paid = invoices.filter((i) => i.status === 'bezahlt').length;

  let revenue = 0;
  invoices
    .filter((i) => i.status === 'bezahlt')
    .forEach((i) => {
      const totals = store.calculateInvoiceTotal(i);
      revenue += totals.brutto;
    });

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-open').textContent = open;
  document.getElementById('stat-paid').textContent = paid;
  document.getElementById('stat-revenue').textContent = formatCurrency(revenue);

  const tbody = document.getElementById('invoices-tbody');
  const empty = document.getElementById('dashboard-empty');
  const table = document.getElementById('invoices-table');

  if (invoices.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  // Sort by date descending
  const sorted = [...invoices].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  tbody.innerHTML = sorted
    .map((inv) => {
      const totals = store.calculateInvoiceTotal(inv);
      const customer = store.getCustomer(inv.customerId);
      const statusClass =
        inv.status === 'bezahlt'
          ? 'badge-paid'
          : inv.status === 'storniert'
          ? 'badge-cancelled'
          : 'badge-open';

      return `<tr>
      <td><strong>${inv.number}</strong></td>
      <td>${formatDate(inv.date)}</td>
      <td>${customer ? customer.name : 'Unbekannt'}</td>
      <td>${formatCurrency(totals.brutto)}</td>
      <td><span class="badge ${statusClass}">${inv.status}</span></td>
      <td>
        <button class="btn-icon" title="PDF exportieren" onclick="exportInvoicePDF('${inv.id}')">&#128196;</button>
        <button class="btn-icon" title="Bearbeiten" onclick="editInvoice('${inv.id}')">&#9998;</button>
        <button class="btn-icon" title="Status ändern" onclick="toggleInvoiceStatus('${inv.id}')">&#10003;</button>
        <button class="btn-icon" title="Löschen" onclick="deleteInvoice('${inv.id}')">&#128465;</button>
      </td>
    </tr>`;
    })
    .join('');
}

async function toggleInvoiceStatus(id) {
  const inv = store.getInvoice(id);
  if (!inv) return;
  const newStatus = inv.status === 'offen' ? 'bezahlt' : 'offen';
  await store.updateInvoice(id, { status: newStatus });
  renderDashboard();
  showToast(`Rechnung als "${newStatus}" markiert`, 'success');
}

async function deleteInvoice(id) {
  if (!confirm('Rechnung wirklich löschen?')) return;
  await store.deleteInvoice(id);
  renderDashboard();
  showToast('Rechnung gelöscht');
}

function editInvoice(id) {
  const inv = store.getInvoice(id);
  if (!inv) return;

  editingInvoiceId = id;
  document.getElementById('invoice-edit-id').value = id;
  document.getElementById('invoice-form-title').textContent = `Rechnung ${inv.number} bearbeiten`;
  document.getElementById('invoice-customer').value = inv.customerId || '';
  document.getElementById('invoice-date').value = inv.date || '';
  document.getElementById('invoice-due-days').value = inv.dueDays || 14;
  document.getElementById('invoice-notes').value = inv.notes || '';

  currentInvoiceItems = JSON.parse(JSON.stringify(inv.items || []));
  renderInvoiceItems();
  recalculateInvoice();

  switchTab('new-invoice');
}

// ==========================
// INVOICES
// ==========================
function updateInvoiceForm() {
  const settings = store.settings;
  if (!settings) return;

  // Tax mode display
  const taxLabel =
    settings.taxMode === 'kleinunternehmer'
      ? 'Kleinunternehmer (§19 UStG) - keine MwSt'
      : 'Regelbesteuerung - MwSt wird ausgewiesen';
  document.getElementById('current-tax-mode').textContent = taxLabel;

  // Show/hide tax columns
  const taxCols = document.querySelectorAll('.tax-col');
  const mwstRow = document.getElementById('mwst-row');
  if (settings.taxMode === 'kleinunternehmer') {
    taxCols.forEach((c) => (c.style.display = 'none'));
    if (mwstRow) mwstRow.style.display = 'none';
  } else {
    taxCols.forEach((c) => (c.style.display = ''));
    if (mwstRow) mwstRow.style.display = '';
  }

  // Populate customer dropdown
  const select = document.getElementById('invoice-customer');
  const currentVal = select.value;
  select.innerHTML = '<option value="">-- Kunde auswählen --</option>';
  store.customers.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
  select.value = currentVal;

  // Set default date
  if (!document.getElementById('invoice-date').value) {
    document.getElementById('invoice-date').value = new Date()
      .toISOString()
      .split('T')[0];
  }

  // Add initial item if empty
  if (currentInvoiceItems.length === 0) {
    addInvoiceItem();
  } else {
    renderInvoiceItems();
  }
}

function addInvoiceItem() {
  currentInvoiceItems.push({
    description: '',
    quantity: 1,
    unit: 'Stk.',
    price: 0,
    taxRate: 19,
  });
  renderInvoiceItems();
}

function removeInvoiceItem(index) {
  currentInvoiceItems.splice(index, 1);
  if (currentInvoiceItems.length === 0) addInvoiceItem();
  else {
    renderInvoiceItems();
    recalculateInvoice();
  }
}

function renderInvoiceItems() {
  const tbody = document.getElementById('items-tbody');
  const settings = store.settings;
  const isKlein = settings && settings.taxMode === 'kleinunternehmer';

  tbody.innerHTML = currentInvoiceItems
    .map((item, i) => {
      const total = item.quantity * item.price;
      return `<tr>
      <td>${i + 1}</td>
      <td><input type="text" value="${escapeHtml(item.description)}" onchange="updateItem(${i},'description',this.value)" placeholder="Beschreibung"></td>
      <td><input type="number" value="${item.quantity}" step="any" onchange="updateItem(${i},'quantity',parseFloat(this.value)||0)"></td>
      <td><input type="text" value="${escapeHtml(item.unit)}" onchange="updateItem(${i},'unit',this.value)" style="width:70px"></td>
      <td><input type="number" value="${item.price}" step="any" onchange="updateItem(${i},'price',parseFloat(this.value)||0)"></td>
      <td class="tax-col" ${isKlein ? 'style="display:none"' : ''}>
        <select onchange="updateItem(${i},'taxRate',parseInt(this.value))">
          <option value="19" ${item.taxRate === 19 ? 'selected' : ''}>19%</option>
          <option value="7" ${item.taxRate === 7 ? 'selected' : ''}>7%</option>
          <option value="0" ${item.taxRate === 0 ? 'selected' : ''}>0%</option>
        </select>
      </td>
      <td class="item-total"><input type="text" value="${formatCurrency(total)}" readonly tabindex="-1" style="text-align:right;background:transparent;border:none;font-weight:500;cursor:default;width:100%;"></td>
      <td><button type="button" class="btn-icon" onclick="removeInvoiceItem(${i})" title="Entfernen">&times;</button></td>
    </tr>`;
    })
    .join('');
}

function updateItem(index, field, value) {
  currentInvoiceItems[index][field] = value;
  recalculateInvoice();
  // Nur Gesamtpreis dieser Zeile aktualisieren - kein kompletter DOM-Neubau
  if (field === 'quantity' || field === 'price') {
    const total = currentInvoiceItems[index].quantity * currentInvoiceItems[index].price;
    const rows = document.querySelectorAll('#items-tbody tr');
    if (rows[index]) {
      const totalInput = rows[index].querySelector('.item-total input');
      if (totalInput) totalInput.value = formatCurrency(total);
    }
  } else if (field === 'taxRate') {
    // Steuerrate geändert - nur Gesamtsummen neu berechnen, kein DOM-Neubau nötig
  }
}

function recalculateInvoice() {
  const settings = store.settings;
  let netto = 0;
  let mwst = 0;

  for (const item of currentInvoiceItems) {
    const itemNetto = item.quantity * item.price;
    netto += itemNetto;
    if (settings && settings.taxMode === 'regelbesteuerung') {
      mwst += itemNetto * ((item.taxRate || 19) / 100);
    }
  }

  netto = Math.round(netto * 100) / 100;
  mwst = Math.round(mwst * 100) / 100;
  const brutto = Math.round((netto + mwst) * 100) / 100;

  document.getElementById('total-netto').textContent = formatCurrency(netto);
  document.getElementById('total-mwst').textContent = formatCurrency(mwst);
  document.getElementById('total-brutto').textContent = formatCurrency(brutto);
}

function resetInvoiceForm() {
  editingInvoiceId = null;
  document.getElementById('invoice-edit-id').value = '';
  document.getElementById('invoice-form-title').textContent = 'Neue Rechnung';
  document.getElementById('invoice-customer').value = '';
  document.getElementById('invoice-date').value = new Date()
    .toISOString()
    .split('T')[0];
  document.getElementById('invoice-due-days').value = '14';
  document.getElementById('invoice-notes').value = '';
  currentInvoiceItems = [];
  addInvoiceItem();
  recalculateInvoice();
}

function collectInvoiceData() {
  return {
    customerId: document.getElementById('invoice-customer').value,
    date: document.getElementById('invoice-date').value,
    dueDays: parseInt(document.getElementById('invoice-due-days').value) || 14,
    notes: document.getElementById('invoice-notes').value,
    items: currentInvoiceItems.filter((item) => item.description.trim() !== ''),
    taxMode: store.settings.taxMode,
  };
}

function setupForms() {
  // Invoice: kein <form> mehr - Buttons haben direkte onclick-Handler

  // Customer form
  document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveCustomer();
  });

  // Settings form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettingsForm();
  });

  // Number preview update
  document.getElementById('settings-invoice-prefix').addEventListener('input', updateNumberPreview);
  document.getElementById('settings-next-number').addEventListener('input', updateNumberPreview);
}

async function saveInvoice() {
  const data = collectInvoiceData();

  if (!data.customerId) {
    showToast('Bitte einen Kunden auswählen', 'error');
    return null;
  }

  if (data.items.length === 0) {
    showToast('Bitte mindestens eine Position hinzufügen', 'error');
    return null;
  }

  let invoice;
  if (editingInvoiceId) {
    invoice = await store.updateInvoice(editingInvoiceId, data);
    showToast('Rechnung aktualisiert', 'success');
  } else {
    invoice = await store.addInvoice(data);
    showToast(`Rechnung ${invoice.number} erstellt`, 'success');
  }

  // Automatisch als PDF in OneDrive speichern (kein Dialog)
  await exportInvoicePDF(invoice.id, true);

  resetInvoiceForm();
  renderDashboard();
  return invoice;
}

async function saveInvoiceAndPDF() {
  const data = collectInvoiceData();

  if (!data.customerId) {
    showToast('Bitte einen Kunden auswählen', 'error');
    return;
  }
  if (data.items.length === 0 || data.items.every(i => !i.description.trim())) {
    showToast('Bitte mindestens eine Position hinzufügen', 'error');
    return;
  }

  let invoice;
  if (editingInvoiceId) {
    invoice = await store.updateInvoice(editingInvoiceId, data);
  } else {
    invoice = await store.addInvoice(data);
  }

  await exportInvoicePDF(invoice.id);
  resetInvoiceForm();
  renderDashboard();
}

async function exportInvoicePDF(invoiceId, skipDialog = false) {
  const inv = store.getInvoice(invoiceId);
  if (!inv) return;

  const settings = await store.loadSettings();
  const customer = store.getCustomer(inv.customerId);
  const totals = store.calculateInvoiceTotal(inv);

  // Logo laden
  let logoData = null;
  const logoPath = await window.api.getLogo();
  if (logoPath) {
    logoData = await window.api.readLogoBase64(logoPath);
  }

  try {
    const pdfBytes = await generateInvoicePDF({
      invoice: inv,
      settings,
      customer,
      totals,
      logoData,
    });

    // Immer automatisch in OneDrive/Daten-Ordner speichern
    const autoPath = await window.api.saveAutoPDF(pdfBytes, inv.number);

    if (!skipDialog) {
      // Zusätzlich Speichern-Dialog für manuelles Speichern
      const savedPath = await window.api.savePDF(pdfBytes, inv.number);
      if (savedPath) {
        showToast(`PDF gespeichert: ${savedPath.split('/').pop()}`, 'success');
      } else {
        showToast(`PDF gespeichert in OneDrive: ${inv.number}.pdf`, 'success');
      }
    } else {
      showToast(`PDF gespeichert in OneDrive: ${inv.number}.pdf`, 'success');
    }

    return autoPath;
  } catch (err) {
    console.error('PDF-Fehler:', err);
    showToast('Fehler beim PDF-Export: ' + err.message, 'error');
  }
}

// ==========================
// CUSTOMERS
// ==========================
function renderCustomersList() {
  const tbody = document.getElementById('customers-tbody');
  const empty = document.getElementById('customers-empty');
  const table = document.getElementById('customers-table');

  if (store.customers.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = store.customers
    .map(
      (c) => `<tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.street || '')} ${escapeHtml(c.zip || '')} ${escapeHtml(c.city || '')}</td>
      <td>${escapeHtml(c.email || '')}</td>
      <td>
        <button class="btn-icon" onclick="editCustomer('${c.id}')" title="Bearbeiten">&#9998;</button>
        <button class="btn-icon" onclick="deleteCustomer('${c.id}')" title="Löschen">&#128465;</button>
      </td>
    </tr>`
    )
    .join('');
}

function showCustomerForm(customer = null) {
  const modal = document.getElementById('customer-modal');
  const title = document.getElementById('customer-modal-title');

  if (customer) {
    title.textContent = 'Kunde bearbeiten';
    document.getElementById('customer-edit-id').value = customer.id;
    document.getElementById('customer-name').value = customer.name || '';
    document.getElementById('customer-street').value = customer.street || '';
    document.getElementById('customer-zip').value = customer.zip || '';
    document.getElementById('customer-city').value = customer.city || '';
    document.getElementById('customer-email').value = customer.email || '';
    document.getElementById('customer-phone').value = customer.phone || '';
  } else {
    title.textContent = 'Neuer Kunde';
    document.getElementById('customer-edit-id').value = '';
    document.getElementById('customer-form').reset();
  }

  modal.classList.add('active');
}

function closeCustomerModal() {
  document.getElementById('customer-modal').classList.remove('active');
}

function editCustomer(id) {
  const customer = store.getCustomer(id);
  if (customer) showCustomerForm(customer);
}

async function deleteCustomer(id) {
  if (!confirm('Kunden wirklich löschen?')) return;
  store.deleteCustomer(id);
  renderCustomersList();
  showToast('Kunde gelöscht');
}

async function saveCustomer() {
  const editId = document.getElementById('customer-edit-id').value;
  const data = {
    name: document.getElementById('customer-name').value.trim(),
    street: document.getElementById('customer-street').value.trim(),
    zip: document.getElementById('customer-zip').value.trim(),
    city: document.getElementById('customer-city').value.trim(),
    email: document.getElementById('customer-email').value.trim(),
    phone: document.getElementById('customer-phone').value.trim(),
  };

  if (!data.name) {
    showToast('Bitte einen Namen eingeben', 'error');
    return;
  }

  if (editId) {
    store.updateCustomer(editId, data);
    showToast('Kunde aktualisiert', 'success');
  } else {
    store.addCustomer(data);
    showToast('Kunde angelegt', 'success');
  }

  closeCustomerModal();
  renderCustomersList();
  updateInvoiceForm();
}

// ==========================
// SETTINGS
// ==========================
async function renderSettingsForm() {
  const s = store.settings;
  if (!s) return;

  document.getElementById('settings-company-name').value = s.company.name || '';
  document.getElementById('settings-address').value = s.company.address || '';
  document.getElementById('settings-zip').value = s.company.zip || '';
  document.getElementById('settings-city').value = s.company.city || '';
  document.getElementById('settings-phone').value = s.company.phone || '';
  document.getElementById('settings-email').value = s.company.email || '';
  document.getElementById('settings-website').value = s.company.website || '';
  document.getElementById('settings-tax-number').value = s.company.taxNumber || '';
  document.getElementById('settings-vat-id').value = s.company.vatId || '';
  document.getElementById('settings-tax-mode').value = s.taxMode || 'kleinunternehmer';
  document.getElementById('settings-bank-name').value = s.company.bankName || '';
  document.getElementById('settings-iban').value = s.company.iban || '';
  document.getElementById('settings-bic').value = s.company.bic || '';
  document.getElementById('settings-invoice-prefix').value = s.invoicePrefix || 'RE';
  document.getElementById('settings-next-number').value = s.nextInvoiceNumber || 1;

  // Data path
  const dataPath = await window.api.getDataPath();
  document.getElementById('settings-data-path').value = dataPath;

  // Logo
  await renderLogoPreview();
  updateNumberPreview();
}

async function renderLogoPreview() {
  const preview = document.getElementById('logo-preview');
  const logoPath = await window.api.getLogo();
  if (logoPath) {
    const logoData = await window.api.readLogoBase64(logoPath);
    if (logoData) {
      preview.innerHTML = `<img src="data:${logoData.mimeType};base64,${logoData.data}" alt="Logo">`;
      return;
    }
  }
  preview.innerHTML = '<span class="logo-placeholder">Kein Logo</span>';
}

async function uploadLogo() {
  const result = await window.api.uploadLogo();
  if (result) {
    showToast('Logo hochgeladen', 'success');
    await renderLogoPreview();
  }
}

async function chooseDataPath() {
  const newPath = await window.api.chooseDataPath();
  if (newPath) {
    document.getElementById('settings-data-path').value = newPath;
    showToast('Daten-Ordner geändert. Bitte App neu starten.', 'success');
  }
}

function updateNumberPreview() {
  const prefix = document.getElementById('settings-invoice-prefix').value || 'RE';
  const num = document.getElementById('settings-next-number').value || '1';
  const year = new Date().getFullYear();
  document.getElementById('settings-number-preview').value =
    `${prefix}-${year}-${String(num).padStart(3, '0')}`;
}

async function saveSettingsForm() {
  const settings = {
    company: {
      name: document.getElementById('settings-company-name').value.trim(),
      address: document.getElementById('settings-address').value.trim(),
      zip: document.getElementById('settings-zip').value.trim(),
      city: document.getElementById('settings-city').value.trim(),
      phone: document.getElementById('settings-phone').value.trim(),
      email: document.getElementById('settings-email').value.trim(),
      website: document.getElementById('settings-website').value.trim(),
      taxNumber: document.getElementById('settings-tax-number').value.trim(),
      vatId: document.getElementById('settings-vat-id').value.trim(),
      bankName: document.getElementById('settings-bank-name').value.trim(),
      iban: document.getElementById('settings-iban').value.trim(),
      bic: document.getElementById('settings-bic').value.trim(),
    },
    taxMode: document.getElementById('settings-tax-mode').value,
    invoicePrefix: document.getElementById('settings-invoice-prefix').value.trim() || 'RE',
    nextInvoiceNumber: parseInt(document.getElementById('settings-next-number').value) || 1,
    logoPath: store.settings.logoPath || '',
  };

  await store.saveSettings(settings);
  showToast('Einstellungen gespeichert', 'success');
  updateInvoiceForm();
}

// --- Helpers ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
