import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { BulkEwbUploadComponent } from './bulk-ewb-upload';

// FIX: EWB number must be exactly 12 digits per GST law
const EWB_NUMBER_LENGTH = 12;

// FIX: Correct validity periods per GST Notification 12/2018
// Strict < comparisons so boundary values fall into the HIGHER band
function getValidityDays(distanceKm: number): number {
  const d = Number(distanceKm) || 0;
  if (d < 100)  return 1;
  if (d < 300)  return 3;
  if (d < 500)  return 5;
  if (d < 1000) return 10;
  return 15;
}

@Component({
  selector: 'app-ewaybill',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe, TitleCasePipe, BulkEwbUploadComponent],
  templateUrl: './ewaybill.html',
  styleUrl: './ewaybill.css'
})
export class Ewaybill implements OnInit, OnDestroy {
  today: Date = new Date();
  transporters: any[]  = [];
  vehicles: any[]      = [];
  consignments: any[]  = [];
  ewaybills: any[]     = [];
  showTable            = false;
  showBulk             = false;
  loading              = false;
  loadingTransporters  = true;   // FIX: loading guards for Step 3
  loadingVehicles      = true;
  successMsg           = '';
  errorMsg             = '';
  stepError            = '';

  // Wizard
  currentStep = 1;
  steps = ['EWB Details', 'Goods Details', 'Transport', 'Review'];

  form: any = {
    ewb_number:    '',
    consignment:   null,
    valid_upto:    '',
    status:        'active',
    hsn_code:      '',
    goods_description: '',
    quantity:      '',
    unit:          '',
    unit_rate:     '',
    taxable_value: '',
    cgst_rate:     '',
    sgst_rate:     '',
    igst_rate:     '',
    transporter:   null,
    vehicle:       null,
    distance_km:   '',
  };

  // FIX: Below-threshold warning (not a hard block — exemptions exist)
  get taxableValueBelowThreshold(): boolean {
    return +this.form.taxable_value > 0 && +this.form.taxable_value < 50000;
  }

  // FIX: CGST+SGST vs IGST mutual exclusion
  get gstConflict(): boolean {
    return (+this.form.cgst_rate > 0 || +this.form.sgst_rate > 0) && +this.form.igst_rate > 0;
  }

  // PDF, Confirm Delete, Skeleton
  downloadingId: any = null;
  showConfirm        = false;
  deleteTarget: any  = null;
  deleting           = false;
  tableLoading       = false;

  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadTransporters();
    this.loadVehicles();
    this.loadConsignments();
    this.generateEWBNumber();
    this.setDefaultValidity();
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  toggleBulk() {
    this.showBulk  = !this.showBulk;
    this.showTable = false;
  }

  onBulkImportDone(result: any) {
    this.successMsg = `✅ Bulk import complete: \${result.created} bill(s) created.`;
    this.showBulk   = false;
    this.showTable    = true;
    this.tableLoading = true;
    this.http.get(`\${environment.apiUrl}/ewaybills/`, { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (res: any) => { this.ewaybills = res.results || res; this.tableLoading = false; this.cdr.detectChanges(); },
        error: ()         => { this.tableLoading = false; }
      });
    setTimeout(() => { this.successMsg = ''; this.cdr.detectChanges(); }, 5000);
    this.cdr.detectChanges();
  }

  // FIX: Generate exactly 12-digit EWB number
  generateEWBNumber() {
    const min = 100000000000; // 10^11
    const max = 999999999999; // 10^12 - 1
    this.form.ewb_number = (Math.floor(Math.random() * (max - min + 1)) + min).toString();
  }

  setDefaultValidity() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    this.form.valid_upto = d.toISOString().slice(0, 16);
  }

  loadTransporters() {
    this.loadingTransporters = true;
    this.http.get(`${environment.apiUrl}/transporters/`, { headers: this.authService.getHeaders() }).subscribe({
      next:  (res: any) => { this.transporters = res.results || res; this.loadingTransporters = false; this.cdr.detectChanges(); },
      error: ()         => { this.loadingTransporters = false; this.cdr.detectChanges(); }
    });
  }

  loadVehicles() {
    this.loadingVehicles = true;
    this.http.get(`${environment.apiUrl}/vehicles/`, { headers: this.authService.getHeaders() }).subscribe({
      next:  (res: any) => { this.vehicles = res.results || res; this.loadingVehicles = false; this.cdr.detectChanges(); },
      error: ()         => { this.loadingVehicles = false; this.cdr.detectChanges(); }
    });
  }

  loadConsignments() {
    // FIX: page_size=500 (more robust). For very large datasets, switch to
    // server-side autocomplete search endpoint.
    this.http.get<any>(
      `${environment.apiUrl}/consignments/?page_size=500`,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next:  (res) => { this.consignments = res.results || res; this.cdr.detectChanges(); },
      error: (err) => console.error('Consignment load error:', err)
    });
  }

  // ── Wizard ──────────────────────────────────────────────────────────────
  validateStep(): boolean {
    this.stepError = '';

    switch (this.currentStep) {
      case 1:
        if (!this.form.ewb_number) {
          this.stepError = 'EWB Number is required.'; return false;
        }
        // FIX: Must be exactly 12 digits
        if (!/^\d{12}$/.test(this.form.ewb_number)) {
          this.stepError = `EWB Number must be exactly ${EWB_NUMBER_LENGTH} digits (got ${this.form.ewb_number.length}).`;
          return false;
        }
        if (!this.form.valid_upto) {
          this.stepError = 'Valid Upto date is required.'; return false;
        }
        // Validate valid_upto is in the future
        if (new Date(this.form.valid_upto) <= new Date()) {
          this.stepError = 'Valid Upto date must be in the future.'; return false;
        }
        return true;

      case 2:
        if (!this.form.hsn_code) {
          this.stepError = 'HSN Code is required.'; return false;
        }
        if (!this.form.taxable_value || +this.form.taxable_value <= 0) {
          this.stepError = 'Taxable Value must be greater than 0.'; return false;
        }
        // FIX: CGST+SGST vs IGST mutual exclusion validation
        if (this.gstConflict) {
          this.stepError = 'Cannot use CGST/SGST together with IGST. Use CGST+SGST for same-state, IGST for inter-state shipments.';
          return false;
        }
        return true;

      case 3:
        if (!this.form.transporter) {
          this.stepError = 'Transporter is required.'; return false;
        }
        if (!this.form.vehicle) {
          this.stepError = 'Vehicle is required.'; return false;
        }
        if (!this.form.distance_km || +this.form.distance_km <= 0) {
          this.stepError = 'Distance (KM) must be greater than 0.'; return false;
        }
        return true;

      default:
        return true;
    }
  }

  nextStep() {
    if (!this.validateStep()) return;
    if (this.currentStep < 4) this.currentStep++;
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

  // ── Calculations ─────────────────────────────────────────────────────────
  calcTaxableValue() {
    const qty  = parseFloat(this.form.quantity  || '0') || 0;
    const rate = parseFloat(this.form.unit_rate || '0') || 0;
    // FIX: Store as number, not string, to avoid downstream parsing issues
    this.form.taxable_value = +(qty * rate).toFixed(2);
  }

  calcTaxAmount(taxable: any, rate: any): string {
    const t = parseFloat(taxable || '0') || 0;
    const r = parseFloat(rate    || '0') || 0;
    return ((t * r) / 100).toFixed(2);
  }

  calcTotalValue(): string {
    const t = parseFloat(this.form.taxable_value || '0') || 0;
    const c = (t * (parseFloat(this.form.cgst_rate || '0') || 0)) / 100;
    const s = (t * (parseFloat(this.form.sgst_rate || '0') || 0)) / 100;
    const i = (t * (parseFloat(this.form.igst_rate || '0') || 0)) / 100;
    return (t + c + s + i).toFixed(2);
  }

  // FIX: Updated to use strict < inequalities matching GST rules
  onDistanceChange() {
    const dist = parseFloat(this.form.distance_km || '0') || 0;
    const days = getValidityDays(dist);
    const d = new Date();
    d.setDate(d.getDate() + days);
    this.form.valid_upto = d.toISOString().slice(0, 16);
  }


  // Category → HSN code map — mirrors consignment.ts
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

  // Official HSN → GST rate map (GST Council, India)
  readonly HSN_GST: Record<string, number> = {
    // 0%
    '0101':0,'0102':0,'0201':0,'0301':0,'0401':0,'1001':0,'1006':0,'1101':0,'0701':0,'0801':0,
    // 5%
    '0902':5,'0910':5,'1501':5,'1502':5,'1507':5,'1601':5,'1602':5,'3004':5,'3006':5,
    '4901':5,'4902':5,'4903':5,'4904':5,'4905':5,
    '5201':5,'5208':5,'5209':5,'5210':5,'5407':5,
    '6101':5,'6102':5,'6201':5,'6202':5,'6203':5,'6204':5,'6205':5,'6206':5,'6211':5,'6305':5,
    '8713':5,'9021':5,
    // 12%
    '1704':12,'1806':12,'1901':12,'1902':12,'1904':12,'2009':12,'2106':12,
    '3401':12,'3402':12,'3406':12,
    '4202':12,'4203':12,'4205':12,
    '6401':12,'6402':12,'6403':12,'6404':12,'6405':12,
    '7013':12,'7323':12,'8215':12,'9401':12,'9403':12,'9404':12,'9405':12,
    // 18%
    '2201':18,'2202':18,'2203':18,'2401':18,
    '3301':18,'3303':18,'3304':18,'3305':18,'3306':18,'3307':18,
    '3808':18,'3814':18,'3820':18,'3923':18,
    '4016':18,'4818':18,'4819':18,'4821':18,
    '5601':18,'5608':18,
    '6910':18,'6911':18,'7321':18,'7322':18,'7324':18,
    '8301':18,'8302':18,'8306':18,'8414':18,'8415':18,'8418':18,
    '8422':18,'8423':18,'8424':18,'8428':18,'8432':18,'8433':18,'8434':18,
    '8471':18,'8473':18,'8517':18,'8518':18,'8519':18,'8521':18,'8523':18,
    '8525':18,'8528':18,'8544':18,'8708':18,
    '9006':18,'9008':18,'9503':18,'9506':18,
    // 28%
    '2402':28,'2403':28,'2707':28,'2710':28,
    '8703':28,'8711':28,'8901':28,'8902':28,'8903':28,'9302':28,'9303':28,
  };

  getGstRate(hsn: string): number | null {
    if (!hsn) return null;
    const h = hsn.trim();
    if (this.HSN_GST[h] !== undefined) return this.HSN_GST[h];
    if (h.length > 4 && this.HSN_GST[h.slice(0,4)] !== undefined) return this.HSN_GST[h.slice(0,4)];
    return null;
  }

  onConsignmentChange() {
    if (!this.form.consignment) return;
    const c = this.consignments.find(x => x.id == this.form.consignment);
    if (!c) return;

    // Auto-fill distance → updates validity period
    if (c.distance_km) {
      this.form.distance_km = c.distance_km;
      this.onDistanceChange();
    }

    // Auto-fill HSN code from consignment's hsn_code field
    if (c.hsn_code) {
      this.form.hsn_code = c.hsn_code;
    }
    // Or derive from product_category if hsn_code not directly set
    else if (c.product_category && this.CATEGORY_HSN[c.product_category]) {
      this.form.hsn_code = this.CATEGORY_HSN[c.product_category];
    }

    // Auto-fill goods description
    if (c.goods_description) {
      this.form.goods_description = c.goods_description;
    } else if (c.product_category && this.CATEGORY_DESC[c.product_category]) {
      this.form.goods_description = this.CATEGORY_DESC[c.product_category];
    }

    // Auto-fill GST rates based on HSN code
    this.onHsnChange();

    // Auto-fill taxable value from consignment's invoice_value if available
    if (c.invoice_value && +c.invoice_value > 0 && !this.form.taxable_value) {
      this.form.taxable_value = c.invoice_value;
    }

    this.cdr.detectChanges();
  }

  // FIX: Uses corrected strict-inequality validity logic
  // Called when HSN code input changes — auto-fills CGST/SGST or IGST
  onHsnChange() {
    const rate = this.getGstRate(this.form.hsn_code);
    if (rate === null) return;
    const half = +(rate / 2).toFixed(2);
    // Determine inter-state from linked consignment
    const c = this.consignments.find(x => x.id == this.form.consignment);
    const isInter = c && c.origin && c.destination && c.origin !== c.destination;
    if (isInter) {
      this.form.igst_rate = rate;
      this.form.cgst_rate = 0;
      this.form.sgst_rate = 0;
    } else {
      this.form.cgst_rate = half;
      this.form.sgst_rate = half;
      this.form.igst_rate = 0;
    }
    this.cdr.detectChanges();
  }

  getValidityDaysLabel(distance: number): string {
    const days = getValidityDays(distance);
    return `${days} Day${days !== 1 ? 's' : ''}`;
  }

  getStatusClass(s: string): string {
    const map: Record<string, string> = {
      active:    'badge-success',
      cancelled: 'badge-danger',
      expired:   'badge-warning',
      delivered: 'badge-info',
    };
    return map[s] || 'badge-info';
  }

  getConsignmentNo(id: any): string {
    const c = this.consignments.find(x => x.id == id);
    return c ? c.consignment_no : '';
  }

  getTransporterName(id: any): string {
    const t = this.transporters.find(x => x.id == id);
    return t ? t.name : '';
  }

  getVehicleNo(id: any): string {
    const v = this.vehicles.find(x => x.id == id);
    return v ? `${v.vehicle_number} — ${v.vehicle_type}` : '';
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  save() {
    this.loading  = true;
    this.errorMsg = '';
    this.successMsg = '';

    const payload = {
      ewb_number:    this.form.ewb_number,
      consignment:   this.form.consignment   || null,
      valid_upto:    this.form.valid_upto,
      status:        this.form.status,
      hsn_code:      this.form.hsn_code,
      goods_description: this.form.goods_description,
      quantity:      parseFloat(this.form.quantity)      || 0,
      unit:          this.form.unit,
      taxable_value: parseFloat(this.form.taxable_value) || 0,
      cgst_rate:     parseFloat(this.form.cgst_rate)     || 0,
      sgst_rate:     parseFloat(this.form.sgst_rate)     || 0,
      igst_rate:     parseFloat(this.form.igst_rate)     || 0,
      transporter:   this.form.transporter   || null,
      vehicle:       this.form.vehicle       || null,
      distance_km:   parseInt(this.form.distance_km)     || 0,
    };

    this.http.post(
      `${environment.apiUrl}/ewaybills/`,
      payload,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: () => {
        this.loading    = false;
        this.successMsg = 'E-Way Bill generated successfully!';
        this.cdr.detectChanges();
        this.showTable   = true;
        this.tableLoading = true;
        this.http.get(
          `${environment.apiUrl}/ewaybills/`,
          { headers: this.authService.getHeaders() }
        ).subscribe({
          next:  (res: any) => { this.ewaybills = res.results || res; this.tableLoading = false; this.cdr.detectChanges(); },
          error: ()         => { this.tableLoading = false; }
        });
        setTimeout(() => { this.successMsg = ''; this.cdr.detectChanges(); }, 5000);
        this.clear();
      },
      error: (err) => {
        this.loading  = false;
        const detail  = err.error?.detail || err.error?.ewb_number?.[0] || JSON.stringify(err.error);
        this.errorMsg = 'Error: ' + detail;
        this.cdr.detectChanges();
      }
    });
  }

  clear() {
    this.currentStep = 1;
    this.stepError   = '';
    this.form = {
      ewb_number: '', consignment: null, valid_upto: '', status: 'active',
      hsn_code: '', goods_description: '', quantity: '', unit: '', unit_rate: '',
      taxable_value: '', cgst_rate: '', sgst_rate: '', igst_rate: '',
      transporter: null, vehicle: null, distance_km: '',
    };
    this.generateEWBNumber();
    this.setDefaultValidity();
  }

  // ── View Table with skeleton ──────────────────────────────────────────────
  viewTable() {
    this.showTable = !this.showTable;
    this.showBulk  = false;
    if (this.showTable) {
      this.tableLoading = true;
      this.http.get(
        `${environment.apiUrl}/ewaybills/`,
        { headers: this.authService.getHeaders() }
      ).subscribe({
        next:  (res: any) => { this.ewaybills = res.results || res; this.tableLoading = false; this.cdr.detectChanges(); },
        error: ()         => { this.tableLoading = false; }
      });
    }
  }

  // ── PDF Download ─────────────────────────────────────────────────────────
  downloadPdf(ewb: any) {
    this.downloadingId = ewb.id;
    this.http.get(
      `${environment.apiUrl}/ewaybills/${ewb.id}/pdf/`,
      { headers: this.authService.getHeaders(), responseType: 'blob' }
    ).subscribe({
      next: (blob: Blob) => {
        const url  = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = `EWB_${ewb.ewb_number}.pdf`;
        link.click();
        window.URL.revokeObjectURL(url);
        this.downloadingId = null;
        this.cdr.detectChanges();
      },
      error: () => {
        this.downloadingId = null;
        this.errorMsg      = 'Failed to download PDF. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  // ── Confirm Delete ────────────────────────────────────────────────────────
  confirmDelete(ewb: any) { this.deleteTarget = ewb; this.showConfirm = true; }
  cancelDelete()          { this.showConfirm = false; this.deleteTarget = null; this.deleting = false; }

  deleteConfirmed() {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.http.delete(
      `${environment.apiUrl}/ewaybills/${this.deleteTarget.id}/`,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: () => {
        this.ewaybills  = this.ewaybills.filter(e => e.id !== this.deleteTarget.id);
        this.successMsg = `EWB ${this.deleteTarget.ewb_number} deleted successfully.`;
        this.cancelDelete();
        this.cdr.detectChanges();
        setTimeout(() => { this.successMsg = ''; this.cdr.detectChanges(); }, 4000);
      },
      error: () => {
        this.errorMsg = 'Failed to delete. Please try again.';
        this.deleting  = false;
        this.cdr.detectChanges();
      }
    });
  }

  logout() { this.authService.logout(); this.router.navigate(['/login']); }
}
