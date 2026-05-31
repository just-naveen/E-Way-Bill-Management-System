import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.css']
})
export class SidebarComponent implements OnInit, OnDestroy {
  user: any     = null;
  currentUrl    = '';
  collapsed     = false;
  expiringCount = 0;

  @Output() collapseChange = new EventEmitter<boolean>();

  private destroy$ = new Subject<void>();
  private pollTimer: any;

  menuItems = [
    { label: 'Dashboard',    icon: '📊', route: '/portal/dashboard'    },
    { label: 'Consignment',  icon: '📦', route: '/portal/consignment'  },
    { label: 'E-Way Bill',   icon: '📋', route: '/portal/ewaybill'     },
    { label: 'Customers',    icon: '👥', route: '/portal/customers'    },
    { label: 'Vehicles',     icon: '🚛', route: '/portal/vehicles'     },
    { label: 'Transporters', icon: '🏢', route: '/portal/transporters' },
    { label: 'Reports',      icon: '📈', route: '/portal/reports'      },
  ];

  adminMenuItems = [
    { label: 'User Management', icon: '🔑', route: '/portal/users'        },
    { label: 'Email Alerts',   icon: '📧', route: '/portal/email-alerts' },
  ];

  customerMenuItems = [
    { label: 'Track Shipment', icon: '🔍', route: '/track' },
  ];

  constructor(
    public authService: AuthService,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.user = this.authService.currentUser;

    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(u => {
        this.user = u;
        if (u) this.loadExpiringCount();
      });

    this.currentUrl = this.router.url;
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd), takeUntil(this.destroy$))
      .subscribe((e: any) => this.currentUrl = e.urlAfterRedirects);

    // Restore collapsed state from localStorage
    this.collapsed = localStorage.getItem('sidebar_collapsed') === 'true';

    if (this.user) this.loadExpiringCount();

    // Poll every 5 minutes
    this.pollTimer = setInterval(() => this.loadExpiringCount(), 5 * 60 * 1000);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    localStorage.setItem('sidebar_collapsed', String(this.collapsed));
    this.collapseChange.emit(this.collapsed);
  }

  // FIX: Use the dedicated /ewaybills/expiring/ endpoint instead of
  // fetching ALL active EWBs and filtering client-side (which only
  // returned the first page and missed records beyond page_size).
  loadExpiringCount() {
    if (!this.authService.isLoggedIn()) return;
    this.http.get<any>(
      `${environment.apiUrl}/ewaybills/expiring/`,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next:  (res) => { this.expiringCount = res.count || 0; },
      error: ()    => { this.expiringCount = 0; }
    });
  }

  get isAdmin():        boolean { return this.authService.isAdmin(); }
  get isAdminOrStaff(): boolean { return this.authService.isOperator(); }
  get isCustomer():     boolean { return !this.isAdminOrStaff; }

  get initials(): string {
    if (!this.user) return '?';
    return (
      (this.user.first_name?.[0] || '') +
      (this.user.last_name?.[0]  || '') ||
      this.user.username?.[0]           ||
      '?'
    ).toUpperCase();
  }

  get displayName(): string {
    return this.user?.first_name || this.user?.username || 'User';
  }

  get avatarClass(): string {
    if (this.user?.role === 'admin') return 'av-admin';
    if (this.user?.role === 'staff') return 'av-staff';
    return 'av-customer';
  }

  isActive(route: string): boolean {
    return this.currentUrl === route || this.currentUrl.startsWith(route + '/');
  }

  logout() {
    this.authService.logout();
  }
}
