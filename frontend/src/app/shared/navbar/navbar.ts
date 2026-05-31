import { Component, Input, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, TitleCasePipe],
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css']
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Input() title = 'Dashboard';

  today      = new Date();
  user: any  = null;
  notifCount = 0;

  // Expiry alerts
  showAlerts    = false;
  alertsLoading = false;
  expiringEWBs: any[] = [];

  private destroy$ = new Subject<void>();
  private pollTimer: any;

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.user = this.authService.currentUser;
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(u => { this.user = u; if (u) this.loadExpiryAlerts(); });

    if (this.user) this.loadExpiryAlerts();

    // Poll every 5 minutes
    this.pollTimer = setInterval(() => this.loadExpiryAlerts(), 5 * 60 * 1000);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  loadExpiryAlerts() {
    if (!this.authService.isLoggedIn()) return;
    // Use dedicated endpoint: auto-expires overdue bills server-side,
    // returns only bills expiring within next 24 hours with all needed fields.
    this.http.get<any>(
      `${environment.apiUrl}/ewaybills/expiring/`,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: (res) => {
        this.expiringEWBs = res.results || [];
        this.notifCount   = res.count   || this.expiringEWBs.length;
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  toggleAlerts() {
    this.showAlerts = !this.showAlerts;
    if (this.showAlerts) this.loadExpiryAlerts();
  }

  closeAlerts() { this.showAlerts = false; }

  // Close dropdown when clicking outside
  @HostListener('document:click', ['$event'])
  onDocClick(e: Event) {
    const target = e.target as HTMLElement;
    if (!target.closest('.bell-wrap')) this.showAlerts = false;
  }

  hoursLeft(validUpto: string): string {
    const diff = new Date(validUpto).getTime() - Date.now();
    const hrs  = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hrs <= 0) return `${mins}m left`;
    return `${hrs}h ${mins}m left`;
  }

  urgencyClass(validUpto: string): string {
    const hrs = (new Date(validUpto).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hrs <= 3)  return 'urgency-critical';
    if (hrs <= 12) return 'urgency-high';
    return 'urgency-medium';
  }

  // ── User helpers ──
  get initials(): string {
    if (!this.user) return '?';
    return ((this.user.first_name?.[0] || '') + (this.user.last_name?.[0] || '')
      || this.user.username?.[0] || '?').toUpperCase();
  }
  get displayName(): string { return this.user?.first_name || this.user?.username || 'User'; }
  get userRole():    string { return this.user?.role || ''; }
  get avatarClass(): string {
    if (this.user?.role === 'admin') return 'av-admin';
    if (this.user?.role === 'staff') return 'av-staff';
    return 'av-customer';
  }
  get roleBadgeClass(): string {
    if (this.user?.role === 'admin') return 'rb-admin';
    if (this.user?.role === 'staff') return 'rb-staff';
    return 'rb-customer';
  }
}
