// Store - Datenverwaltung über preload API

class Store {
  constructor() {
    this.settings = null;
    this.customers = [];
    this.invoices = [];
  }

  // --- Settings ---
  async loadSettings() {
    this.settings = await window.api.getSettings();
    return this.settings;
  }

  async saveSettings(settings) {
    this.settings = settings;
    await window.api.saveSettings(settings);
  }

  // --- Customers ---
  async loadCustomers() {
    this.customers = await window.api.getCustomers();
    return this.customers;
  }

  async saveCustomers() {
    await window.api.saveCustomers(this.customers);
  }

  addCustomer(customer) {
    customer.id = this.generateId();
    customer.createdAt = new Date().toISOString();
    this.customers.push(customer);
    this.saveCustomers();
    return customer;
  }

  updateCustomer(id, data) {
    const index = this.customers.findIndex((c) => c.id === id);
    if (index !== -1) {
      this.customers[index] = { ...this.customers[index], ...data };
      this.saveCustomers();
      return this.customers[index];
    }
    return null;
  }

  deleteCustomer(id) {
    this.customers = this.customers.filter((c) => c.id !== id);
    this.saveCustomers();
  }

  getCustomer(id) {
    return this.customers.find((c) => c.id === id) || null;
  }

  // --- Invoices ---
  async loadInvoices() {
    this.invoices = await window.api.getInvoices();
    return this.invoices;
  }

  async saveInvoices() {
    await window.api.saveInvoices(this.invoices);
  }

  async getNextInvoiceNumber() {
    const settings = await this.loadSettings();
    const year = new Date().getFullYear();
    const num = String(settings.nextInvoiceNumber || 1).padStart(3, '0');
    return `${settings.invoicePrefix || 'RE'}-${year}-${num}`;
  }

  async incrementInvoiceNumber() {
    const settings = await this.loadSettings();
    settings.nextInvoiceNumber = (settings.nextInvoiceNumber || 1) + 1;
    await this.saveSettings(settings);
  }

  async addInvoice(invoice) {
    invoice.id = this.generateId();
    invoice.createdAt = new Date().toISOString();
    invoice.number = await this.getNextInvoiceNumber();
    invoice.status = 'offen';
    this.invoices.push(invoice);
    await this.saveInvoices();
    await this.incrementInvoiceNumber();
    return invoice;
  }

  async updateInvoice(id, data) {
    const index = this.invoices.findIndex((inv) => inv.id === id);
    if (index !== -1) {
      this.invoices[index] = { ...this.invoices[index], ...data };
      await this.saveInvoices();
      return this.invoices[index];
    }
    return null;
  }

  async deleteInvoice(id) {
    this.invoices = this.invoices.filter((inv) => inv.id !== id);
    await this.saveInvoices();
  }

  getInvoice(id) {
    return this.invoices.find((inv) => inv.id === id) || null;
  }

  // --- Helpers ---
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  calculateInvoiceTotal(invoice) {
    const settings = this.settings;
    let netto = 0;
    let mwst = 0;

    for (const item of invoice.items) {
      const itemNetto = item.quantity * item.price;
      netto += itemNetto;

      if (settings.taxMode === 'regelbesteuerung') {
        const rate = item.taxRate || 19;
        mwst += itemNetto * (rate / 100);
      }
    }

    return {
      netto: Math.round(netto * 100) / 100,
      mwst: Math.round(mwst * 100) / 100,
      brutto: Math.round((netto + mwst) * 100) / 100,
    };
  }
}

const store = new Store();
