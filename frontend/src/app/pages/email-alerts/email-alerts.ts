import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

interface EmailConfig {
  enabled: boolean;
  recipient_emails: string[];
  alert_hours_before: number;   // default 24
  send_time: string;            // HH:MM e.g. "08:00"
  include_ewb_details: boolean;
  include_goods_details: boolean;
  notify_on_cancel: boolean;
  last_run: string | null;
  last_run_count: number;
}

@Component({
  selector: 'app-email-alerts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './email-alerts.html',
  styleUrl: './email-alerts.css'
})
export class EmailAlertsComponent implements OnInit {

  loading       = true;
  saving        = false;
  testing       = false;
  successMsg    = '';
  errorMsg      = '';
  testMsg       = '';
  newEmail      = '';
  emailError    = '';

  config: EmailConfig = {
    enabled:               false,
    recipient_emails:      [],
    alert_hours_before:    24,
    send_time:             '08:00',
    include_ewb_details:   true,
    include_goods_details: false,
    notify_on_cancel:      true,
    last_run:              null,
    last_run_count:        0,
  };

  // preview of what the email looks like
  showPreview = false;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    this.loading = true;
    this.http.get<EmailConfig>(
      `${environment.apiUrl}/email-alerts/config/`,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: (res) => {
        this.config  = { ...this.config, ...res };
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        // If endpoint doesn't exist yet, use defaults silently
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── email chip management ──────────────────────────────

  addEmail() {
    this.emailError = '';
    const email = this.newEmail.trim().toLowerCase();
    if (!email) return;
    if (!this.isValidEmail(email)) {
      this.emailError = 'Please enter a valid email address.';
      return;
    }
    if (this.config.recipient_emails.includes(email)) {
      this.emailError = 'This email is already added.';
      return;
    }
    if (this.config.recipient_emails.length >= 10) {
      this.emailError = 'Maximum 10 recipients allowed.';
      return;
    }
    this.config.recipient_emails = [...this.config.recipient_emails, email];
    this.newEmail = '';
    this.cdr.detectChanges();
  }

  removeEmail(email: string) {
    this.config.recipient_emails = this.config.recipient_emails.filter(e => e !== email);
  }

  onEmailKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this.addEmail();
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // ── save ──────────────────────────────────────────────

  save() {
    this.errorMsg  = '';
    this.successMsg = '';

    if (this.config.enabled && this.config.recipient_emails.length === 0) {
      this.errorMsg = 'Please add at least one recipient email before enabling alerts.';
      return;
    }

    this.saving = true;
    this.http.post(
      `${environment.apiUrl}/email-alerts/config/`,
      this.config,
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: () => {
        this.saving     = false;
        this.successMsg = '✅ Email alert settings saved successfully!';
        this.cdr.detectChanges();
        setTimeout(() => { this.successMsg = ''; this.cdr.detectChanges(); }, 4000);
      },
      error: (err) => {
        this.saving   = false;
        this.errorMsg = err?.error?.error || 'Failed to save settings. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  // ── send test email ───────────────────────────────────

  sendTest() {
    this.testMsg = '';
    if (this.config.recipient_emails.length === 0) {
      this.testMsg = '⚠️ Add at least one recipient to send a test email.';
      return;
    }
    this.testing = true;
    this.http.post(
      `${environment.apiUrl}/email-alerts/test/`,
      { emails: this.config.recipient_emails },
      { headers: this.authService.getHeaders() }
    ).subscribe({
      next: () => {
        this.testing = false;
        this.testMsg = '✅ Test email sent! Check your inbox.';
        this.cdr.detectChanges();
        setTimeout(() => { this.testMsg = ''; this.cdr.detectChanges(); }, 5000);
      },
      error: (err) => {
        this.testing = false;
        this.testMsg = '❌ ' + (err?.error?.error || 'Failed to send test email.');
        this.cdr.detectChanges();
      }
    });
  }

  // ── helpers ───────────────────────────────────────────

  get statusLabel(): string {
    return this.config.enabled ? 'Alerts Active' : 'Alerts Disabled';
  }

  get lastRunText(): string {
    if (!this.config.last_run) return 'Never run yet';
    const d = new Date(this.config.last_run);
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  togglePreview() {
    this.showPreview = !this.showPreview;
  }
}
