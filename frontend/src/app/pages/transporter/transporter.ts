import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { WayBillValidators } from '../../core/validators';   // FIX: import validators

@Component({
  selector: 'app-transporter',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe],
  templateUrl: './transporter.html',
  styleUrl: './transporter.css'
})
export class Transporter implements OnInit, OnDestroy {
  transporters: any[] = [];
  filtered: any[]     = [];
  loading   = false;
  saving    = false;
  showModal = false;
  isEdit    = false;
  searchText = '';
  successMsg = '';
  errorMsg   = '';
  selectedId: number | null = null;
  form: any = { name: '', gstin: '', mobile: '', address: '' };
  private destroy$ = new Subject<void>();

  // ── Pagination ──
  currentPage = 1;
  pageSize    = 10;
  totalCount  = 0;
  totalPages  = 0;
  pages: number[] = [];

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit()    { this.loadTransporters(); }
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

  loadTransporters(page: number = this.currentPage) {
    this.loading = true;
    const params = `?page=${page}&page_size=${this.pageSize}` +
      (this.searchText ? `&search=${encodeURIComponent(this.searchText)}` : '');

    this.http.get(`${environment.apiUrl}/transporters/${params}`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.ngZone.run(() => {
            this.transporters = res.results ?? res ?? [];
            this.filtered     = [...this.transporters];
            this.totalCount   = res?.count ?? this.transporters.length;
            this.currentPage  = page;
            this.buildPages();
            this.loading = false;
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.ngZone.run(() => { this.loading = false; });
          this.cdr.detectChanges();
        }
      });
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadTransporters(page);
  }

  onPageSizeChange() { this.currentPage = 1; this.loadTransporters(1); }
  search()           { this.currentPage = 1; this.loadTransporters(1); }

  openAdd() {
    this.isEdit = false; this.selectedId = null;
    this.form = { name: '', gstin: '', mobile: '', address: '' };
    this.errorMsg = ''; this.showModal = true;
  }

  openEdit(t: any) {
    this.isEdit = true; this.selectedId = t.id;
    this.form = { ...t }; this.errorMsg = ''; this.showModal = true;
  }

  closeModal() { this.showModal = false; this.errorMsg = ''; }

  save() {
    this.errorMsg = '';

    // ── FIX: Validate all fields before submitting ──
    const nameErr   = WayBillValidators.name(this.form.name, 'Transporter name');
    const mobileErr = WayBillValidators.mobile(this.form.mobile);
    const gstinErr  = WayBillValidators.gstin(this.form.gstin);

    if (nameErr)   { this.errorMsg = nameErr;   return; }
    if (mobileErr) { this.errorMsg = mobileErr; return; }
    if (gstinErr)  { this.errorMsg = gstinErr;  return; }

    // Auto-uppercase GSTIN before saving
    if (this.form.gstin) {
      this.form.gstin = this.form.gstin.trim().toUpperCase();
    }

    this.saving = true;

    const req = this.isEdit
      ? this.http.put(`${environment.apiUrl}/transporters/${this.selectedId}/`,
          this.form, { headers: this.authService.getHeaders() })
      : this.http.post(`${environment.apiUrl}/transporters/`,
          this.form, { headers: this.authService.getHeaders() });

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.successMsg = this.isEdit ? 'Transporter updated!' : 'Transporter added!';
        this.saving = false; this.showModal = false;
        this.loadTransporters(this.currentPage);
        setTimeout(() => this.successMsg = '', 3000);
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.detail || err?.error?.name?.[0] || 'Error saving transporter.';
      }
    });
  }

  delete(id: number) {
    if (!confirm('Delete this transporter?')) return;
    this.http.delete(`${environment.apiUrl}/transporters/${id}/`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.successMsg = 'Deleted!';
          const page = this.transporters.length === 1 && this.currentPage > 1
            ? this.currentPage - 1 : this.currentPage;
          this.loadTransporters(page);
          setTimeout(() => this.successMsg = '', 3000);
        },
        error: () => { this.errorMsg = 'Error deleting transporter.'; }
      });
  }
}
