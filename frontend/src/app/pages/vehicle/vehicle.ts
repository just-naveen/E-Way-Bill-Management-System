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
  selector: 'app-vehicle',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe],
  templateUrl: './vehicle.html',
  styleUrl: './vehicle.css'
})
export class Vehicle implements OnInit, OnDestroy {
  vehicles: any[]     = [];
  filtered: any[]     = [];
  transporters: any[] = [];
  loading    = false;
  saving     = false;
  showModal  = false;
  isEdit     = false;
  searchText = '';
  successMsg = '';
  errorMsg   = '';
  selectedId: number | null = null;
  form: any = { vehicle_number: '', vehicle_type: '', transporter: '' };
  vehicleTypes = ['Two Wheeler','Three Wheeler','LCV','HCV','Trailer','Container','Tanker','Other'];
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

  ngOnInit()    { this.loadVehicles(); this.loadTransporters(); }
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

  loadVehicles(page: number = this.currentPage) {
    this.loading = true;
    const params = `?page=${page}&page_size=${this.pageSize}` +
      (this.searchText ? `&search=${encodeURIComponent(this.searchText)}` : '');

    this.http.get(`${environment.apiUrl}/vehicles/${params}`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.ngZone.run(() => {
            this.vehicles    = res.results ?? res ?? [];
            this.filtered    = [...this.vehicles];
            this.totalCount  = res?.count ?? this.vehicles.length;
            this.currentPage = page;
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

  loadTransporters() {
    this.http.get(`${environment.apiUrl}/transporters/?page_size=1000`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => this.transporters = res.results ?? res,
        error: () => {}
      });
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadVehicles(page);
  }

  onPageSizeChange() { this.currentPage = 1; this.loadVehicles(1); }
  search()           { this.currentPage = 1; this.loadVehicles(1); }

  openAdd() {
    this.isEdit = false; this.selectedId = null;
    this.form = { vehicle_number: '', vehicle_type: '', transporter: '' };
    this.errorMsg = ''; this.showModal = true;
  }

  openEdit(v: any) {
    this.isEdit = true; this.selectedId = v.id;
    this.form = { ...v }; this.errorMsg = ''; this.showModal = true;
  }

  closeModal() { this.showModal = false; this.errorMsg = ''; }

  save() {
    this.errorMsg = '';

    // ── FIX: Validate vehicle number format before submitting ──
    const vnErr = WayBillValidators.vehicleNumber(this.form.vehicle_number);
    if (vnErr) { this.errorMsg = vnErr; return; }

    // Auto-uppercase the vehicle number before saving
    this.form.vehicle_number = this.form.vehicle_number.trim().toUpperCase();

    this.saving = true;

    const req = this.isEdit
      ? this.http.put(`${environment.apiUrl}/vehicles/${this.selectedId}/`,
          this.form, { headers: this.authService.getHeaders() })
      : this.http.post(`${environment.apiUrl}/vehicles/`,
          this.form, { headers: this.authService.getHeaders() });

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.successMsg = this.isEdit ? 'Vehicle updated!' : 'Vehicle added!';
        this.saving = false; this.showModal = false;
        this.loadVehicles(this.currentPage);
        setTimeout(() => this.successMsg = '', 3000);
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = err?.error?.vehicle_number?.[0] ||
          err?.error?.detail || 'Error saving vehicle.';
      }
    });
  }

  delete(id: number) {
    if (!confirm('Delete this vehicle?')) return;
    this.http.delete(`${environment.apiUrl}/vehicles/${id}/`,
      { headers: this.authService.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.successMsg = 'Vehicle deleted!';
          const page = this.vehicles.length === 1 && this.currentPage > 1
            ? this.currentPage - 1 : this.currentPage;
          this.loadVehicles(page);
          setTimeout(() => this.successMsg = '', 3000);
        },
        error: () => { this.errorMsg = 'Error deleting vehicle.'; }
      });
  }

  getTransporterName(id: number): string {
    const t = this.transporters.find(t => t.id === id);
    return t ? t.name : '-';
  }

  getTypeClass(type: string): string {
    const map: any = {
      'HCV': 'badge-info', 'LCV': 'badge-purple', 'Trailer': 'badge-warning',
      'Container': 'badge-success', 'Tanker': 'badge-danger'
    };
    return map[type] || 'badge-info';
  }
}
