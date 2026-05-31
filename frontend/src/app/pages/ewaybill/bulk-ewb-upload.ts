// ✅ FIXED VERSION — uses simple http.post (NOT HttpRequest+reportProgress)
// Verify: line 7 should show HttpHeaders, NOT HttpRequest
import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

export interface BulkUploadError { row: number; ewb_number: string; reason: string; }
export interface BulkUploadResult { created: number; skipped: number; errors: BulkUploadError[]; total_rows: number; }

@Component({
  selector: 'app-bulk-ewb-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bulk-ewb-upload.html',
  styleUrls: ['./bulk-ewb-upload.css'],
})
export class BulkEwbUploadComponent {
  @Output() importDone = new EventEmitter<BulkUploadResult>();
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadProgress = 0;
  result: BulkUploadResult | null = null;
  apiError: string | null = null;

  constructor(private http: HttpClient, private authService: AuthService) {}

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging = true; }
  onDragLeave() { this.isDragging = false; }
  onDrop(e: DragEvent) { e.preventDefault(); this.isDragging = false; const f = e.dataTransfer?.files[0]; if (f) this.setFile(f); }
  onFileSelect(e: Event) { const i = e.target as HTMLInputElement; if (i.files?.[0]) this.setFile(i.files[0]); }

  setFile(file: File) {
    this.apiError = null; this.result = null;
    if (!file.name.toLowerCase().endsWith('.csv')) { this.apiError = 'Only .csv files accepted.'; return; }
    if (file.size > 5 * 1024 * 1024) { this.apiError = 'Max 5 MB.'; return; }
    this.selectedFile = file;
  }

  clearFile(e: Event) {
    e.stopPropagation();
    this.selectedFile = null; this.result = null; this.apiError = null; this.uploadProgress = 0;
  }

  upload() {
    if (!this.selectedFile || this.uploading) return;
    this.uploading = true; this.uploadProgress = 0; this.result = null; this.apiError = null;

    const formData = new FormData();
    formData.append('file', this.selectedFile);

    // Remove Content-Type — browser sets multipart/form-data + boundary automatically
    let headers: HttpHeaders = this.authService.getHeaders();
    headers = headers.delete('Content-Type');

    this.http.post<BulkUploadResult>(
      `${environment.apiUrl}/ewaybills/bulk-upload/`,
      formData,
      { headers }
    ).subscribe({
      next: (res) => {
        this.uploading = false;
        this.uploadProgress = 100;
        this.result = res;
        if (res.created > 0) this.importDone.emit(res);
      },
      error: (err) => {
        this.uploading = false;
        this.uploadProgress = 0;
        this.apiError = err?.error?.error || err?.error?.detail || `Upload failed (${err.status})`;
      }
    });
  }

  downloadTemplate() {
    this.http.get(`${environment.apiUrl}/ewaybills/bulk-upload/template/`,
      { headers: this.authService.getHeaders(), responseType: 'blob' }
    ).subscribe({
      next: (blob) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'ewb_template.csv'; a.click(); URL.revokeObjectURL(u); },
      error: () => {
        const csv = 'ewb_number,valid_upto,consignment_no,hsn_code,goods_description,quantity,unit,taxable_value,cgst_rate,sgst_rate,igst_rate,distance_km,status\n123456789012,2026-12-31 23:59,,8471,Electronics,10,NOS,50000,9,9,0,250,active';
        const b = new Blob([csv], { type: 'text/csv' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'ewb_template.csv'; a.click(); URL.revokeObjectURL(u);
      }
    });
  }

  exportErrors() {
    if (!this.result?.errors?.length) return;
    const csv = ['row,ewb_number,reason', ...this.result.errors.map(e => `${e.row},${e.ewb_number},"${e.reason.replace(/"/g,'""')}"`)].join('\n');
    const b = new Blob([csv], { type: 'text/csv' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'errors.csv'; a.click(); URL.revokeObjectURL(u);
  }
}
