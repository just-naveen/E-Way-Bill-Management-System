import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DecimalPipe, TitleCasePipe],
  templateUrl: './reports.html',
  styleUrl: './reports.css'
})
export class Reports implements OnInit, OnDestroy {
  loading = false;
  consignmentReport: any = null;
  ewaybillReport: any    = null;

  activePreset = 'This Month';

  filters = { date_from: '', date_to: '' };

  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit()    { this.applyPreset('This Month'); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  /**
   * FIX: Use local date formatting instead of toISOString() which converts
   * to UTC and shifts dates backward for IST (UTC+5:30) users.
   * e.g. new Date(2026, 3, 1).toISOString() → "2026-03-31T18:30:00.000Z" ❌
   *      toLocalDate(new Date(2026, 3, 1))   → "2026-04-01"               ✅
   */
  private toLocalDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ── Quick Preset Buttons ──────────────────────────────────────
  applyPreset(preset: string) {
    this.activePreset = preset;
    const now   = new Date();
    const today = this.toLocalDate(now);   // FIX: was now.toISOString().slice(0,10)

    switch (preset) {
      case 'Today':
        this.filters.date_from = today;
        this.filters.date_to   = today;
        break;

      case 'Yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yd = this.toLocalDate(y);    // FIX
        this.filters.date_from = yd;
        this.filters.date_to   = yd;
        break;
      }

      case 'Last 7 Days': {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        this.filters.date_from = this.toLocalDate(d);   // FIX
        this.filters.date_to   = today;
        break;
      }

      case 'Last 30 Days': {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        this.filters.date_from = this.toLocalDate(d);   // FIX
        this.filters.date_to   = today;
        break;
      }

      case 'This Month':
        // FIX: was new Date(...).toISOString().slice(0,10) which gave wrong date
        this.filters.date_from = this.toLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
        this.filters.date_to   = today;
        break;

      case 'Last Month': {
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last  = new Date(now.getFullYear(), now.getMonth(), 0);
        this.filters.date_from = this.toLocalDate(first);  // FIX
        this.filters.date_to   = this.toLocalDate(last);   // FIX
        break;
      }

      case 'This Year':
        this.filters.date_from = this.toLocalDate(new Date(now.getFullYear(), 0, 1)); // FIX
        this.filters.date_to   = today;
        break;

      case 'Custom':
        // Don't change dates — user will pick from the date inputs
        break;
    }

    if (preset !== 'Custom') {
      this.loadReports();
    }
  }

  onCustomDateChange() {
    this.activePreset = 'Custom';
  }

  // ── Load Reports ──────────────────────────────────────────────
  loadReports() {
    // FIX: Validate dates for Custom preset before hitting the API
    if (this.activePreset === 'Custom') {
      if (!this.filters.date_from || !this.filters.date_to) {
        alert('Please select both From and To dates.');
        return;
      }
      if (this.filters.date_from > this.filters.date_to) {
        alert('From Date cannot be after To Date.');
        return;
      }
    }

    this.loading = true;
    this.cdr.detectChanges();

    const params = new URLSearchParams();
    if (this.filters.date_from) params.set('date_from', this.filters.date_from);
    if (this.filters.date_to)   params.set('date_to',   this.filters.date_to);
    const qs = params.toString() ? `?${params.toString()}` : '';

    forkJoin({
      consignment: this.http.get(
        `${environment.apiUrl}/reports/consignments/${qs}`,
        { headers: this.authService.getHeaders() }
      ),
      // FIX: Pass the same date range to ewaybill report too
      ewaybill: this.http.get(
        `${environment.apiUrl}/reports/ewaybills/${qs}`,
        { headers: this.authService.getHeaders() }
      )
    })
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (res: any) => {
        this.consignmentReport = res.consignment;
        this.ewaybillReport    = res.ewaybill;
        this.loading           = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Report load error:', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Icon / Badge helpers ──────────────────────────────────────
  getServiceIcon(type: string): string {
    return ({ standard: '📦', express: '⚡', overnight: '🌙' } as any)[type] || '📦';
  }
  getPaymentIcon(mode: string): string {
    return ({ credit: '💳', cash: '💵', online: '📱' } as any)[mode] || '💰';
  }
  getStatusIcon(status: string): string {
    return ({ active: '✅', cancelled: '❌', expired: '⚠️', delivered: '📬' } as any)[status] || '📋';
  }
  getStatusClass(status: string): string {
    return ({ active: 'badge-success', cancelled: 'badge-danger', expired: 'badge-warning', delivered: 'badge-info' } as any)[status] || 'badge-info';
  }

  logout() { this.authService.logout(); }
}
