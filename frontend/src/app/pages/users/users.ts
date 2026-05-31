import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject, of } from 'rxjs';
import { takeUntil, timeout, catchError } from 'rxjs/operators';

export interface UserModel {
  id?: number;
  username?: string;
  email: string;
  first_name: string;
  last_name: string;
  mobile: string;
  role: 'admin' | 'staff';   // ✅ lowercase — matches Django model
  is_active: boolean;
  date_joined?: string;
  created_at?: string;
  password?: string;
  confirm_password?: string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe],  // ✅ RouterModule added
  templateUrl: './users.html',
  styleUrl: './users.css'
})
export class UsersComponent implements OnInit, OnDestroy {

  today = new Date();

  // ── Sidebar user data ──────────────────────────────────────
  currentUser: any = null;

  get initials(): string {
    const u = this.currentUser;
    if (!u) return '?';
    return ((u.first_name?.[0] || '') + (u.last_name?.[0] || '') || u.username?.[0] || '?').toUpperCase();
  }
  get displayName(): string {
    const u = this.currentUser;
    return u?.first_name || u?.username || 'User';
  }
  get avatarClass(): string {
    if (this.currentUser?.role === 'admin') return 'av-admin';
    if (this.currentUser?.role === 'staff') return 'av-staff';
    return 'av-customer';
  }

  // ── Table data ─────────────────────────────────────────────
  users:    UserModel[] = [];
  filtered: UserModel[] = [];

  loading  = false;
  saving   = false;
  showModal         = false;
  showDeleteConfirm = false;
  isEdit   = false;

  searchText   = '';
  filterRole   = '';
  filterStatus = '';

  successMsg = '';
  errorMsg   = '';

  selectedId       = 0;
  deleteTargetName = '';

  showPassword        = false;
  showConfirmPassword = false;

  private destroy$ = new Subject<void>();

  // ── Role config — lowercase to match Django ────────────────
  roleConfig = {
    admin: { label: 'Admin', icon: '👑', desc: 'Full access' },
    staff: { label: 'Staff', icon: '⚙️', desc: 'Operations' },
  };

  form: UserModel = this.emptyForm();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.currentUser = this.authService.currentUser;

    if (!this.authService.isAdmin()) {
      this.router.navigate(['/portal/dashboard']);
      return;
    }
    this.loadUsers();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  emptyForm(): UserModel {
    return {
      email: '', first_name: '', last_name: '',
      mobile: '', role: 'staff', is_active: true,
      password: '', confirm_password: ''
    };
  }

  // ── Load users ─────────────────────────────────────────────
  loadUsers() {
    this.loading  = true;
    this.errorMsg = '';

    // ✅ FIXED: correct endpoint — /users/ not /auth/users/
    this.http.get<any>(`${environment.apiUrl}/users/`, {
      headers: this.authService.getHeaders()
    })
    .pipe(
      timeout(8000),
      catchError(err => {
        this.loading  = false;
        if (err?.status === 403)      this.errorMsg = 'Access denied. Admin role required.';
        else if (err?.status === 401) this.router.navigate(['/login']);
        else if (err?.name === 'TimeoutError') this.errorMsg = 'Server timeout. Check Django is running.';
        else                         this.errorMsg = `Error loading users (${err?.status || 'unknown'})`;
        return of({ results: [] });
      }),
      takeUntil(this.destroy$)
    )
    .subscribe((res: any) => {
      const data   = res?.results ?? res ?? [];
      this.users   = Array.isArray(data) ? data : [];
      this.applyFilter();
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  // ── Filter ─────────────────────────────────────────────────
  applyFilter() {
    let result = [...this.users];

    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result  = result.filter(u =>
        u.first_name?.toLowerCase().includes(q) ||
        u.last_name?.toLowerCase().includes(q)  ||
        u.email?.toLowerCase().includes(q)      ||
        u.mobile?.includes(q)
      );
    }
    if (this.filterRole)   result = result.filter(u => u.role === this.filterRole);
    if (this.filterStatus) result = result.filter(u => u.is_active === (this.filterStatus === 'active'));

    this.filtered = result;
  }

  // ── Modal open/close ───────────────────────────────────────
  openAdd() {
    this.isEdit     = false;
    this.selectedId = 0;
    this.form       = this.emptyForm();
    this.errorMsg   = '';
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.showModal  = true;
  }

  openEdit(u: UserModel) {
    this.isEdit     = true;
    this.selectedId = u.id!;
    this.form       = { ...u, password: '', confirm_password: '' };
    this.errorMsg   = '';
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.showModal  = true;
  }

  closeModal() { this.showModal = false; this.errorMsg = ''; }

  // ── Save ───────────────────────────────────────────────────
  save() {
    if (!this.form.first_name?.trim()) { this.errorMsg = 'First name is required.'; return; }
    if (!this.form.last_name?.trim())  { this.errorMsg = 'Last name is required.';  return; }
    if (!this.form.email?.trim())      { this.errorMsg = 'Email is required.';       return; }
    if (!this.isEdit) {
      if (!this.form.password)              { this.errorMsg = 'Password is required.';                return; }
      if ((this.form.password?.length??0) < 6) { this.errorMsg = 'Password must be at least 6 characters.'; return; }
      if (this.form.password !== this.form.confirm_password) { this.errorMsg = 'Passwords do not match.'; return; }
    }
    if (this.isEdit && this.form.password && this.form.password !== this.form.confirm_password) {
      this.errorMsg = 'Passwords do not match.'; return;
    }

    this.saving   = true;
    this.errorMsg = '';

    const payload: any = {
      email:      this.form.email,
      first_name: this.form.first_name,
      last_name:  this.form.last_name,
      mobile:     this.form.mobile,
      role:       this.form.role,          // ✅ sends 'admin' or 'staff' (lowercase)
      is_active:  this.form.is_active,
    };
    if (!this.isEdit || this.form.password) {
      payload.password         = this.form.password;
      payload.confirm_password = this.form.confirm_password;
    }

    const url = this.isEdit
      ? `${environment.apiUrl}/users/${this.selectedId}/`
      : `${environment.apiUrl}/users/`;

    const req = this.isEdit
      ? this.http.put(url, payload, { headers: this.authService.getHeaders() })
      : this.http.post(url, payload, { headers: this.authService.getHeaders() });

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving     = false;
        this.showModal  = false;
        this.successMsg = this.isEdit ? 'User updated successfully!' : 'User created successfully!';
        this.loadUsers();
        setTimeout(() => this.successMsg = '', 3500);
      },
      error: (err) => {
        this.saving   = false;
        const e       = err.error;
        this.errorMsg = e?.email?.[0] || e?.password?.[0] || e?.detail
          || e?.non_field_errors?.[0] || JSON.stringify(e)
          || 'Error saving user. Please try again.';
      }
    });
  }

  // ── Delete ─────────────────────────────────────────────────
  confirmDelete(u: UserModel) {
    this.selectedId       = u.id!;
    this.deleteTargetName = `${u.first_name} ${u.last_name}`;
    this.showDeleteConfirm = true;
  }

  cancelDelete() { this.showDeleteConfirm = false; this.selectedId = 0; }

  deleteUser() {
    if (!this.selectedId) return;
    this.http.delete(
      `${environment.apiUrl}/users/${this.selectedId}/`,
      { headers: this.authService.getHeaders() }
    )
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.successMsg = 'User deleted successfully!';
        this.loadUsers();
        setTimeout(() => this.successMsg = '', 3500);
      },
      error: () => {
        this.showDeleteConfirm = false;
        this.errorMsg = 'Error deleting user.';
      }
    });
  }

  // ── Toggle status ──────────────────────────────────────────
  toggleStatus(u: UserModel) {
    this.http.patch(
      `${environment.apiUrl}/users/${u.id}/`,
      { is_active: !u.is_active },
      { headers: this.authService.getHeaders() }
    )
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: () => {
        u.is_active   = !u.is_active;
        this.successMsg = `User ${u.is_active ? 'activated' : 'deactivated'}.`;
        setTimeout(() => this.successMsg = '', 3000);
      },
      error: () => { this.errorMsg = 'Error updating user status.'; }
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  getRoleInfo(role: string) {
    return (this.roleConfig as any)[role] || { label: role, icon: '👤' };
  }

  getInitials(u: UserModel): string {
    return ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() || '?';
  }

  get stats() {
    return {
      total:    this.users.length,
      admin:    this.users.filter(u => u.role === 'admin').length,   // ✅ lowercase
      staff:    this.users.filter(u => u.role === 'staff').length,   // ✅ lowercase
      active:   this.users.filter(u => u.is_active).length,
      inactive: this.users.filter(u => !u.is_active).length,
    };
  }

  logout() { this.authService.logout(); }
}
