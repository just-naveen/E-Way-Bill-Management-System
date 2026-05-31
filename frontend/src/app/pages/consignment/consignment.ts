import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe, DecimalPipe } from '@angular/common'; // FIX 1: DecimalPipe added (used by number pipe in template)
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { WaybillPrintComponent } from '../../shared/waybill-print/waybill-print.component';
import { takeUntil, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-consignment',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe, TitleCasePipe, DecimalPipe, WaybillPrintComponent], // FIX 1: DecimalPipe in imports
  templateUrl: './consignment.html',
  styleUrl: './consignment.css'
})
export class Consignment implements OnInit, OnDestroy {
  today: Date = new Date();
  customers: any[] = [];
  showTable = false;
  consignments: any[] = [];
  loading = false;
  successMsg = '';
  errorMsg = '';
  stepError = '';

  currentStep = 1;
  steps = ['Consignment', 'Consignor', 'Consignee', 'Shipment', 'Billing', 'Info & Review'];

  form: any = {
    is_manual_cd:      true,
    consignment_no:    '',
    booking_date:      new Date().toISOString().slice(0, 16),
    customer:          '',
    origin:            '',
    destination:       '',
    service_type:      '',
    pincode:           '',
    consignor_name:    '',
    consignor_city:    '',
    consignor_address: '',
    consignor_mobile:  '',
    consignor_pincode: '',
    consignor_state:   '',
    consignor_gstin:   '',
    consignee_name:    '',
    consignee_city:    '',
    consignee_address: '',
    consignee_mobile:  '',
    consignee_state:   '',
    consignee_gstin:   '',
    total_pieces:      '',
    actual_weight:     '',
    volumetric_weight: '',
    length:            '',
    width:             '',
    height:            '',
    chargeable_weight: '',
    ewaybill_no:       '',   // optional: user can pre-fill if they already have one
    product_category:  '',
    payment_mode:      'credit',
    rate_per_kg:       '',
    freight_amt:       '',
    fsc_amt:           '',
    other_charge:      '',
    total_amt:         '',
    cgst_pct:          '',
    sgst_pct:          '',
    igst_pct:          '',
    cgst:              '',
    sgst:              '',
    igst:              '',
    net_total_amt:     '',
    invoice_currency:  'INR',
    delivery_type:     'door_delivery',
    freight_charge_by: 'consignor',
    doc_type:          'non_documents',
  };

  private destroy$ = new Subject<void>();

  // Search & Filter
  searchText    = '';
  filterFrom    = '';
  filterTo      = '';
  filterService = '';
  filteredConsignments: any[] = [];
  tableLoading  = false;

  // Confirm Delete
  showConfirm  = false;
  deleteTarget: any = null;
  deleting     = false;

  // Print LR
  showPrintPreview = false;
  printTarget: any = null;
  savedConsignment: any = null;
  pdfDownloading = false;

  // EWB threshold (display only — enforcement is on E-Way Bill page)

  // Category → HSN code map (standard GST HSN codes)
  readonly CATEGORY_HSN: Record<string, string> = {
    'electronics': '8471',
    'clothing':    '6203',
    'food':        '2106',
    'machinery':   '8428',
    'furniture':   '9403',
    'pharma':      '3004',
    'auto_parts':  '8708',
    'books':       '4901',
    'other':       '9999',
  };

  // Category → description map for EWB page pre-fill
  readonly CATEGORY_DESC: Record<string, string> = {
    'electronics': 'Electronic goods and accessories',
    'clothing':    'Clothing and textile products',
    'food':        'Food and perishable goods',
    'machinery':   'Machinery and industrial equipment',
    'furniture':   'Furniture and furnishings',
    'pharma':      'Pharmaceutical and medical products',
    'auto_parts':  'Automobile parts and accessories',
    'books':       'Books, stationery and printed material',
    'other':       'General goods',
  };

  onCategoryChange() {
    const cat = this.form.product_category;
    if (cat && this.CATEGORY_HSN[cat]) {
      this.form.hsn_code          = this.CATEGORY_HSN[cat];
      this.form.goods_description = this.CATEGORY_DESC[cat] || '';
    } else {
      this.form.hsn_code          = '';
      this.form.goods_description = '';
    }
    this.cdr.detectChanges();
  }


  // FIX 2: GST conflict getter — used in template for inline warnings
  get gstConflict(): boolean {
    return (+this.form.cgst_pct > 0 || +this.form.sgst_pct > 0) && +this.form.igst_pct > 0;
  }

  readonly indianStates = [
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
    'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
    'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
    'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
    'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
    'Ladakh','Lakshadweep','Puducherry'
  ];

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadCustomers();
    this.generateConsignmentNo();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  generateConsignmentNo() {
    const now      = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const tsPart   = now.getTime().toString(36).toUpperCase();
    const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.form.consignment_no = `CNS-${datePart}-${tsPart}${randPart}`;
  }

  loadCustomers() {
    this.http.get(`${environment.apiUrl}/customers/?page_size=500`, { headers: this.authService.getHeaders() }) // FIX 3: page_size=500 so all customers appear in dropdown
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { this.customers = res.results || res; this.cdr.detectChanges(); },
        error: (err) => { if (!environment.production) console.error('[Consignment] loadCustomers:', err); }
      });
  }



  onCustomerChange() {
    const selectedId = Number(this.form.customer);
    if (!selectedId) {
      this.form.consignor_name    = '';
      this.form.consignor_mobile  = '';
      this.form.consignor_address = '';
      this.form.consignor_city    = '';
      this.form.consignor_pincode = '';
      this.form.consignor_state   = '';
      return;
    }
    const customer = this.customers.find(c => c.id === selectedId);
    if (!customer) return;
    this.form.consignor_name    = customer.name    || '';
    this.form.consignor_mobile  = customer.mobile  || '';
    this.form.consignor_address = customer.address || '';
    if (customer.city)    this.form.consignor_city    = customer.city;
    if (customer.pincode) this.form.consignor_pincode = customer.pincode;
    if (customer.city)    this.form.consignor_city    = customer.city;
    if (customer.state)   this.form.consignor_state   = customer.state;
    if (customer.pincode) this.form.consignor_pincode = customer.pincode;
    if (customer.gstin)   this.form.consignor_gstin   = customer.gstin;
    // Also set origin state from customer state
    if (customer.state && !this.form.origin) this.form.origin = customer.state;
    this.cdr.detectChanges();
  }

  // ── Wizard Navigation ─────────────────────────────────────────────────────

  validateStep(): boolean {
    this.stepError = '';
    switch (this.currentStep) {
      case 1:
        if (!this.form.consignment_no) { this.stepError = 'Consignment No is required.'; return false; }
        if (!this.form.booking_date)   { this.stepError = 'Booking Date is required.'; return false; }
        if (!this.form.origin)         { this.stepError = 'Origin state is required.'; return false; }
        if (!this.form.destination)    { this.stepError = 'Destination state is required.'; return false; }
        if (!this.form.service_type) { this.stepError = 'Service Type is required.'; return false; }
        return true;

      case 2:
        if (!this.form.consignor_name) { this.stepError = 'Consignor Name is required.'; return false; }
        if (!this.form.consignor_city) { this.stepError = 'Consignor City is required.'; return false; }
        if (this.form.consignor_mobile && !/^\d{10}$/.test(this.form.consignor_mobile)) {
          this.stepError = 'Consignor mobile must be exactly 10 digits.'; return false;
        }
        return true;

      case 3:
        if (!this.form.consignee_name) { this.stepError = 'Consignee Name is required.'; return false; }
        if (!this.form.consignee_city) { this.stepError = 'Consignee City is required.'; return false; }
        if (this.form.consignee_mobile && !/^\d{10}$/.test(this.form.consignee_mobile)) {
          this.stepError = 'Consignee mobile must be exactly 10 digits.'; return false;
        }
        return true;

      case 4:
        if (!this.form.total_pieces  || +this.form.total_pieces  <= 0) { this.stepError = 'Total Pieces must be greater than 0.'; return false; }
        if (!this.form.actual_weight || +this.form.actual_weight <= 0) { this.stepError = 'Actual Weight must be greater than 0.'; return false; }
        if (!this.form.product_category) { this.stepError = 'Product Category is required.'; return false; }
        // FIX 4: Validate pincode format if entered (6 digits for India)
        if (this.form.consignor_pincode && !/^\d{6}$/.test(this.form.consignor_pincode)) {
          this.stepError = 'Consignor pincode must be 6 digits.'; return false;
        }
        return true;

      case 5:
        if (!this.form.payment_mode) { this.stepError = 'Payment Mode is required.'; return false; }
        // FIX 5: GST conflict check moved here (step 5 is Billing — correct place)
        if (this.gstConflict) {
          this.stepError = 'Use CGST + SGST (same state) OR IGST (inter-state) — not both.'; return false;
        }
        // FIX 6: Warn if net_total_amt is 0 but rate_per_kg was entered — means calcFreight wasn't called
        if (+this.form.rate_per_kg > 0 && +this.form.freight_amt === 0) {
          this.calcFreight(); // auto-recalculate silently before proceeding
        }
        return true;

      default: return true;
    }
  }

  nextStep() {
    if (!this.validateStep()) return;
    if (this.currentStep < 6) this.currentStep++;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  prevStep() {
    this.stepError = '';
    if (this.currentStep > 1) this.currentStep--;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  goToStep(step: number) {
    if (step < this.currentStep) { this.stepError = ''; this.currentStep = step; }
  }

  // ── Calculations ──────────────────────────────────────────────────────────

  calcVolumetric() {
    const l = parseFloat(this.form.length || 0) || 0;
    const w = parseFloat(this.form.width  || 0) || 0;
    const h = parseFloat(this.form.height || 0) || 0;
    // Standard courier volumetric formula: L × W × H / 5000
    this.form.volumetric_weight = ((l * w * h) / 5000).toFixed(2);
    this.calcChargeable();
  }

  calcChargeable() {
    const actual = parseFloat(this.form.actual_weight     || 0) || 0;
    const vol    = parseFloat(this.form.volumetric_weight || 0) || 0;
    // Chargeable = higher of actual vs volumetric weight
    this.form.chargeable_weight = Math.max(actual, vol).toFixed(2);
    this.calcFreight();
  }

  calcFreight() {
    const rate   = parseFloat(this.form.rate_per_kg       || 0) || 0;
    const weight = parseFloat(this.form.chargeable_weight || 0) || 0;
    this.form.freight_amt = (rate * weight).toFixed(2);
    this.calcTotal();
  }

  calcTotal() {
    const freight = parseFloat(this.form.freight_amt  || 0) || 0;
    const fsc     = parseFloat(this.form.fsc_amt      || 0) || 0;
    const other   = parseFloat(this.form.other_charge || 0) || 0;
    const subtotal = freight + fsc + other;

    this.form.total_amt = subtotal.toFixed(2);

    // FIX 7: GST must be calculated on subtotal (freight + fsc + other),
    // GST applies to the service charge (freight + fsc + other), NOT on goods value.
    const cgstAmt = subtotal * ((parseFloat(this.form.cgst_pct || 0) || 0) / 100);
    const sgstAmt = subtotal * ((parseFloat(this.form.sgst_pct || 0) || 0) / 100);
    const igstAmt = subtotal * ((parseFloat(this.form.igst_pct || 0) || 0) / 100);

    this.form.cgst = cgstAmt.toFixed(2);
    this.form.sgst = sgstAmt.toFixed(2);
    this.form.igst = igstAmt.toFixed(2);

    this.form.net_total_amt = (subtotal + cgstAmt + sgstAmt + igstAmt).toFixed(2);
    this.cdr.detectChanges(); // FIX 8: trigger CD so billing summary updates live
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  save() {
    this.loading = true;
    this.errorMsg = '';
    this.successMsg = '';

    // FIX 9: Strip UI-only fields (length, width, height, cgst_pct, sgst_pct, igst_pct)
    // before sending to Django — these don't exist as model fields.
    const {
      length, width, height,       // volumetric calc helpers — not in model
      cgst_pct, sgst_pct, igst_pct, // percentage inputs — model stores amounts only
      ...rest
    } = this.form;

    const payload = {
      ...rest,
      customer:          this.form.customer  || null,
      total_pieces:      parseInt(this.form.total_pieces)        || 0,
      actual_weight:     parseFloat(this.form.actual_weight)     || 0,
      volumetric_weight: parseFloat(this.form.volumetric_weight) || 0,
      chargeable_weight: parseFloat(this.form.chargeable_weight) || 0,
      rate_per_kg:       parseFloat(this.form.rate_per_kg)       || 0,
      freight_amt:       parseFloat(this.form.freight_amt)       || 0,
      fsc_amt:           parseFloat(this.form.fsc_amt)           || 0,
      other_charge:      parseFloat(this.form.other_charge)      || 0,
      total_amt:         parseFloat(this.form.total_amt)         || 0,
      cgst:              parseFloat(this.form.cgst)              || 0,
      sgst:              parseFloat(this.form.sgst)              || 0,
      igst:              parseFloat(this.form.igst)              || 0,
      net_total_amt:     parseFloat(this.form.net_total_amt)     || 0,
    };

    this.http.post(`${environment.apiUrl}/consignments/`, payload, { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$), timeout(20000))
      .subscribe({
        next: (res: any) => {
          this.loading          = false;
          this.successMsg       = 'Consignment saved successfully!';
          this.savedConsignment = res;
          this.showPrintPreview = true;
          this.clear();  // Reset form so re-opening wizard generates a new consignment number
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.loading = false;
          if (err.name === 'TimeoutError') {
            this.errorMsg = '⏱️ Request timed out. Please try again.';
          } else {
            this.errorMsg = err.error?.detail
              || err.error?.non_field_errors?.[0]
              || err.error?.consignment_no?.[0]
              || Object.values(err.error || {}).flat().join(' ')
              || 'Something went wrong. Please try again.';
          }
          if (!environment.production) console.error('[Consignment] save:', err);
          this.cdr.detectChanges();
        }
      });
  }

  clear() {
    this.currentStep = 1;
    this.stepError   = '';
    this.form = {
      is_manual_cd:      true,
      consignment_no:    '',
      booking_date:      new Date().toISOString().slice(0, 16),
      customer:          '',
      origin:            '',
      destination:       '',
      service_type:      '',
      pincode:           '',
      consignor_name:    '',
      consignor_city:    '',
      consignor_address: '',
      consignor_mobile:  '',
      consignor_pincode: '',
      consignor_state:   '',
      consignor_gstin:   '',
      consignee_name:    '',
      consignee_city:    '',
      consignee_address: '',
      consignee_mobile:  '',
      consignee_state:   '',
      consignee_gstin:   '',
      total_pieces:      '',
      actual_weight:     '',
      volumetric_weight: '',
      length:            '',
      width:             '',
      height:            '',
      chargeable_weight: '',
      ewaybill_no:       '',
      product_category:  '',
      hsn_code:          '',
      goods_description: '',
      payment_mode:      'credit',
      rate_per_kg:       '',
      freight_amt:       '',
      fsc_amt:           '',
      other_charge:      '',
      total_amt:         '',
      cgst_pct:          '',
      sgst_pct:          '',
      igst_pct:          '',
      cgst:              '',
      sgst:              '',
      igst:              '',
      net_total_amt:     '',
      invoice_currency:  'INR',
      delivery_type:     'door_delivery',
      freight_charge_by: 'consignor',
      doc_type:          'non_documents',
    };
    this.generateConsignmentNo();
  }

  // ── View Table ────────────────────────────────────────────────────────────

  viewTable() {
    this.showTable = !this.showTable;
    if (this.showTable) {
      this.tableLoading = true;
      this.http.get(`${environment.apiUrl}/consignments/`, { headers: this.authService.getHeaders() })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res: any) => {
            this.consignments = this.filteredConsignments = res.results || res;
            this.tableLoading = false;
            this.cdr.detectChanges();
          },
          error: () => {
            this.tableLoading = false;
            this.errorMsg = 'Failed to load consignments.';
            this.cdr.detectChanges();
          }
        });
    }
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  applyFilters() {
    let result = [...this.consignments];

    if (this.searchText.trim()) {
      const s = this.searchText.toLowerCase();
      result = result.filter(c =>
        c.consignment_no?.toLowerCase().includes(s)  ||
        c.origin?.toLowerCase().includes(s)          ||
        c.destination?.toLowerCase().includes(s)     ||
        c.consignor_name?.toLowerCase().includes(s)  ||
        c.consignee_name?.toLowerCase().includes(s)
      );
    }

    // FIX 10: Date filter — booking_date from Django is an ISO string.
    // Comparing ISO string >= 'YYYY-MM-DD' works because ISO strings
    // sort lexicographically. But we must compare only the date part
    // for the filterTo upper bound (strip time from the record's date).
    if (this.filterFrom) {
      result = result.filter(c => c.booking_date?.slice(0, 10) >= this.filterFrom);
    }
    if (this.filterTo) {
      result = result.filter(c => c.booking_date?.slice(0, 10) <= this.filterTo);
    }

    if (this.filterService) {
      result = result.filter(c => c.service_type === this.filterService);
    }

    this.filteredConsignments = result;
    this.cdr.detectChanges();
  }

  clearSearch()  { this.searchText = ''; this.applyFilters(); }
  clearFilters() {
    this.searchText    = '';
    this.filterFrom    = '';
    this.filterTo      = '';
    this.filterService = '';
    this.filteredConsignments = [...this.consignments];
    this.cdr.detectChanges();
  }
  get hasActiveFilters(): boolean {
    return !!(this.searchText || this.filterFrom || this.filterTo || this.filterService);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  confirmDelete(c: any) { this.deleteTarget = c; this.showConfirm = true; }
  cancelDelete()        { this.showConfirm = false; this.deleteTarget = null; this.deleting = false; }

  deleteConfirmed() {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.http.delete(`${environment.apiUrl}/consignments/${this.deleteTarget.id}/`, { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          // FIX 11: Update both arrays consistently after delete
          this.consignments         = this.consignments.filter(c => c.id !== this.deleteTarget.id);
          this.filteredConsignments = this.filteredConsignments.filter(c => c.id !== this.deleteTarget.id);
          this.successMsg = `✅ Consignment ${this.deleteTarget.consignment_no} deleted.`;
          this.cancelDelete();
          this.cdr.detectChanges();
          setTimeout(() => { this.successMsg = ''; this.cdr.detectChanges(); }, 4000);
        },
        error: () => {
          this.errorMsg = '❌ Failed to delete.';
          this.deleting = false;
          this.cdr.detectChanges();
        }
      });
  }

  // ── Print ─────────────────────────────────────────────────────────────────

  printLR(c: any) { this.savedConsignment = c; this.printTarget = c; this.showPrintPreview = true; }
  closePrint()    { this.showPrintPreview = false; this.printTarget = null; this.savedConsignment = null; }
  triggerPrint()  { window.print(); }

  downloadConsignmentPdf() {
    if (!this.savedConsignment?.id) return;
    this.pdfDownloading = true;
    this.http.get(
      `${environment.apiUrl}/consignments/${this.savedConsignment.id}/pdf/`,
      { headers: this.authService.getHeaders(), responseType: 'blob' }
    ).pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (blob: Blob) => {
        const url  = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = `CNS_${this.savedConsignment.consignment_no}.pdf`;
        link.click();
        window.URL.revokeObjectURL(url);
        this.pdfDownloading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.pdfDownloading = false;
        this.errorMsg = 'Failed to download PDF. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  logout() { this.authService.logout(); this.router.navigate(['/login']); }
}
