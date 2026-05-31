import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { WayBillValidators } from '../../core/validators';   // FIX: import validators

@Component({
  selector: 'app-customer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './customer.html',
  styleUrl: './customer.css'
})
export class Customer implements OnInit, OnDestroy {
  today: Date = new Date();
  customers: any[] = [];
  filtered: any[]  = [];
  loading  = false;
  saving   = false;
  showModal = false;
  isEdit   = false;
  searchText = '';
  successMsg = '';
  errorMsg   = '';
  selectedId: number | null = null;
  private destroy$ = new Subject<void>();

  // ── Pagination ──
  currentPage = 1;
  pageSize    = 10;
  totalCount  = 0;
  totalPages  = 0;
  pages: number[] = [];

  form: any = { name: '', company_name: '', mobile: '', email: '', address: '', city: '', state: '', pincode: '', gstin: '' };

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

  ngOnInit()    { this.loadCustomers(); }
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  buildPages() {
    this.totalPages = Math.ceil(this.totalCount / this.pageSize) || 1;
    this.pages = Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  get visiblePages(): number[] {
    const delta = 2;
    return this.pages.filter(p =>
      p === 1 || p === this.totalPages ||
      (p >= this.currentPage - delta && p <= this.currentPage + delta)
    );
  }

  get fromRecord(): number { return this.totalCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1; }
  get toRecord():   number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }

  loadCustomers(page: number = this.currentPage) {
    this.loading  = true;
    this.errorMsg = '';
    const params  = `?page=${page}&page_size=${this.pageSize}` +
      (this.searchText ? `&search=${encodeURIComponent(this.searchText)}` : '');

    this.http.get(`${environment.apiUrl}/customers/${params}`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const data       = res?.results ?? res ?? [];
          this.customers   = Array.isArray(data) ? data : [];
          this.filtered    = [...this.customers];
          this.totalCount  = res?.count ?? this.customers.length;
          this.currentPage = page;
          this.buildPages();
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.loading = false;
          if (err.status === 401) {
            this.errorMsg = 'Session expired. Please log in again.';
            setTimeout(() => this.router.navigate(['/login']), 1500);
          } else if (err.status === 0) {
            this.errorMsg = 'Cannot connect to server. Make sure Django is running.';
          } else {
            this.errorMsg = `Error loading customers (${err.status})`;
          }
        }
      });
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadCustomers(page);
  }

  onPageSizeChange() { this.currentPage = 1; this.loadCustomers(1); }
  search()           { this.currentPage = 1; this.loadCustomers(1); }

  openAdd() {
    this.isEdit = false; this.selectedId = null;
    this.form = { name: '', company_name: '', mobile: '', email: '', address: '', city: '', state: '', pincode: '', gstin: '' };
    this.errorMsg = ''; this.showModal = true;
  }

  openEdit(c: any) {
    this.isEdit = true; this.selectedId = c.id;
    this.form = { ...c }; this.errorMsg = ''; this.showModal = true;
  }

  closeModal() { this.showModal = false; this.errorMsg = ''; }

  save() {
    this.errorMsg = '';

    // ── FIX: Validate all fields before submitting ──
    const nameErr   = WayBillValidators.name(this.form.name, 'Customer name');
    const mobileErr = WayBillValidators.mobile(this.form.mobile);
    const emailErr  = WayBillValidators.email(this.form.email);
    const gstinErr  = WayBillValidators.gstin(this.form.gstin);

    if (nameErr)   { this.errorMsg = nameErr;   return; }
    if (mobileErr) { this.errorMsg = mobileErr; return; }
    if (emailErr)  { this.errorMsg = emailErr;  return; }
    if (gstinErr)  { this.errorMsg = gstinErr;  return; }

    // Auto-uppercase GSTIN before saving
    if (this.form.gstin) {
      this.form.gstin = this.form.gstin.trim().toUpperCase();
    }

    this.saving = true;

    const req = this.isEdit
      ? this.http.put(`${environment.apiUrl}/customers/${this.selectedId}/`,
          this.form, { headers: this.authService.getHeaders() })
      : this.http.post(`${environment.apiUrl}/customers/`,
          this.form, { headers: this.authService.getHeaders() });

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false; this.showModal = false;
        this.successMsg = this.isEdit ? 'Customer updated!' : 'Customer added!';
        this.loadCustomers(this.currentPage);
        setTimeout(() => this.successMsg = '', 3000);
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err.error?.detail || err.error?.name?.[0] ||
          JSON.stringify(err.error) || 'Error saving customer.';
      }
    });
  }

  delete(id: number) {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    this.http.delete(`${environment.apiUrl}/customers/${id}/`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.successMsg = 'Customer deleted!';
          const page = this.customers.length === 1 && this.currentPage > 1
            ? this.currentPage - 1 : this.currentPage;
          this.loadCustomers(page);
          setTimeout(() => this.successMsg = '', 3000);
        },
        error: () => { this.errorMsg = 'Error deleting customer.'; }
      });
  }

  logout() { this.authService.logout(); this.router.navigate(['/login']); }
}
