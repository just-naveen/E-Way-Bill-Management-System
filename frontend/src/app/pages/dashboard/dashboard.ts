import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe, DecimalPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, TitleCasePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit, OnDestroy {

  loading              = false;
  loadingConsignments  = false;
  user: any            = null;
  recentConsignments: any[] = [];

  revenueChart: Chart | null     = null;
  consignmentChart: Chart | null = null;

  stats = {
    total_consignments: 0,
    today_bookings:     0,
    active_ewaybills:   0,
    expired_ewaybills:  0,
    expiring_soon:      0,
    total_customers:    0,
    total_vehicles:     0,
    monthly_revenue:    0,
    revenue_trend:      [] as number[],   // NEW: array of 6 monthly values from API
    service_split:      [] as number[],   // NEW: [standard, express, overnight]
  };

  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.user = this.authService.currentUser;
    this.loadStats();
    if (this.isAdminOrStaff) this.loadRecentConsignments();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    // Destroy charts to avoid canvas reuse error
    this.revenueChart?.destroy();
    this.consignmentChart?.destroy();
  }

  get isAdmin()        { return this.authService.isAdmin(); }
  get isStaff()        { return this.authService.isStaff(); }
  get isAdminOrStaff() { return this.authService.isOperator(); }
  get isCustomer()     { return !this.isAdminOrStaff; }

  get displayName(): string {
    return this.user?.first_name || this.user?.username || 'User';
  }

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  get welcomeSubText(): string {
    if (this.isAdmin) return 'Full system access — manage users, reports, and all operations.';
    if (this.isStaff) return 'Manage consignments, e-way bills, customers and vehicles.';
    return 'Track your shipments and view e-way bill status below.';
  }

  get roleIcon(): string {
    if (this.isAdmin) return '👑';
    if (this.isStaff) return '⚙️';
    return '📦';
  }

  get welcomeBannerClass(): string {
    if (this.isAdmin) return 'wb-admin';
    if (this.isStaff) return 'wb-staff';
    return 'wb-customer';
  }

  loadStats() {
    this.loading = true;
    this.cdr.detectChanges();

    this.http.get<any>(
      `${environment.apiUrl}/dashboard/stats/`,
      { headers: this.authService.getHeaders() }
    )
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (res) => {
        this.stats   = { ...this.stats, ...res };
        this.loading = false;
        this.cdr.detectChanges();
        setTimeout(() => this.initCharts(), 200);
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadRecentConsignments() {
    this.loadingConsignments = true;

    this.http.get<any>(
      `${environment.apiUrl}/consignments/?limit=5`,
      { headers: this.authService.getHeaders() }
    )
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (res) => {
        this.recentConsignments  = res?.results ?? [];
        this.loadingConsignments = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingConsignments = false;
        this.recentConsignments  = [];
        this.cdr.detectChanges();
      }
    });
  }

  initCharts() {
    this.createRevenueChart();
    this.createConsignmentChart();
  }

  createRevenueChart() {
    const ctx = document.getElementById('revenueChart') as HTMLCanvasElement;
    if (!ctx) return;

    this.revenueChart?.destroy();

    // Use real trend data from API if available, else fall back to placeholder
    const data = this.stats.revenue_trend?.length === 6
      ? this.stats.revenue_trend
      : [200000, 320000, 280000, 410000, 380000, this.stats.monthly_revenue];

    // Get last 6 month labels
    const labels = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return d.toLocaleString('default', { month: 'short' });
    });

    this.revenueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          tension: 0.4,
          fill: true,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          pointBackgroundColor: '#6366f1',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: (v: any) => '₹' + (v / 1000) + 'K',
              font: { size: 11 }
            },
            grid: { color: '#f1f5f9' }
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          }
        }
      }
    });
  }

  createConsignmentChart() {
    const ctx = document.getElementById('consignmentChart') as HTMLCanvasElement;
    if (!ctx) return;

    this.consignmentChart?.destroy();

    // Use real split data from API if available
    const data = this.stats.service_split?.length === 3
      ? this.stats.service_split
      : [12, 8, 5];

    this.consignmentChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Standard', 'Express', 'Overnight'],
        datasets: [{
          data,
          backgroundColor: ['#6366f1', '#0891b2', '#d97706'],
          borderWidth: 0,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              boxWidth: 10,
              padding: 14,
              font: { size: 11 }
            }
          }
        }
      }
    });
  }
}
