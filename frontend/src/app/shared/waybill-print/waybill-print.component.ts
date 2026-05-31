import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-waybill-print',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './waybill-print.component.html',
  styleUrls: ['./waybill-print.component.css']
})
export class WaybillPrintComponent implements OnInit, OnDestroy {

  // Pass consignment object directly OR just the ID to fetch
  @Input() consignment: any = null;
  @Input() consignmentId: number | null = null;

  today     = new Date();
  loading   = false;
  errorMsg  = '';
  ewbData: any = null;   // linked EWB if any

  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  ngOnInit() {
    if (this.consignmentId && !this.consignment) {
      this.fetchConsignment(this.consignmentId);
    } else if (this.consignment?.ewaybill_no) {
      this.fetchEwb(this.consignment.ewaybill_no);
    }
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  fetchConsignment(id: number) {
    this.loading = true;
    this.http.get(`${environment.apiUrl}/consignments/${id}/`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.consignment = res;
          this.loading = false;
          if (res.ewaybill_no) this.fetchEwb(res.ewaybill_no);
        },
        error: () => { this.loading = false; this.errorMsg = 'Could not load consignment.'; }
      });
  }

  fetchEwb(ewbNo: string) {
    this.http.get(`${environment.apiUrl}/ewaybills/?search=${ewbNo}`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const items = res?.results ?? res ?? [];
          this.ewbData = items.find((e: any) => e.ewb_number === ewbNo) ?? items[0] ?? null;
        },
        error: () => {}
      });
  }

  // ── Calculations ──
  get subTotal(): number {
    const c = this.consignment;
    if (!c) return 0;
    return (+c.freight_amt || 0) + (+c.fsc_amt || 0) + (+c.other_charge || 0);
  }

  get totalGst(): number {
    const c = this.consignment;
    if (!c) return 0;
    return (+c.cgst || 0) + (+c.sgst || 0) + (+c.igst || 0);
  }

  get netTotal(): number {
    return this.subTotal + this.totalGst;
  }

  // ── Print ──
  print() {
    window.print();
  }

  // ── Download PDF using jsPDF (loaded via CDN) ──
  async downloadPdf() {
    const { jsPDF } = (window as any).jspdf;
    if (!jsPDF) {
      alert('PDF library not loaded. Please try the Print option instead.');
      return;
    }

    const element = document.getElementById('waybill-content');
    if (!element) return;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.html(element, {
      callback: (pdf: any) => {
        const cns = this.consignment?.consignment_no || 'waybill';
        pdf.save(`WayBill-${cns}.pdf`);
      },
      x: 10, y: 10,
      width: 190,
      windowWidth: 794,
      autoPaging: 'text',
    });
  }

  // ── Number to words (for invoice) ──
  numberToWords(num: number): string {
    if (!num) return 'Zero';
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                  'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                  'Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

    const convert = (n: number): string => {
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
      if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + convert(n%100) : '');
      if (n < 100000) return convert(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + convert(n%1000) : '');
      if (n < 10000000) return convert(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + convert(n%100000) : '');
      return convert(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + convert(n%10000000) : '');
    };

    const rounded = Math.round(num);
    const paise = Math.round((num - rounded) * 100);
    let result = convert(rounded) + ' Rupees';
    if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
    return result + ' Only';
  }
}
