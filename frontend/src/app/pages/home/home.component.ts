import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  trackNo        = '';
  mobileOpen     = false;
  contactSent    = false;
  isScrolled     = false;
  contactSending = false;
  contactError   = '';

  contact = { firstName: '', lastName: '', email: '', message: '' };

  steps = [
    { icon: '🏢', title: 'Create Account',   desc: 'Register with your GSTIN and company details to set up your digital workspace.' },
    { icon: '⚙️', title: 'Configure Master', desc: 'Add recurring customers, vehicle numbers, and item masters for one-click entry.' },
    { icon: '📦', title: 'Book & Generate',  desc: 'Book consignments and instantly generate E-Way Bills via direct portal integration.' },
    { icon: '📊', title: 'Track & Report',   desc: 'Monitor transit status and generate performance compliance reports at month-end.' },
  ];

  statsData = [
    { num: '1.2M+',  label: 'Bills Generated', desc: 'Generated on our platform' },
    { num: '8,400+', label: 'Businesses',       desc: 'Across India trust us'     },
    { num: '28',     label: 'States Covered',   desc: 'Pan-India network'         },
    { num: '99.9%',  label: 'Uptime',           desc: 'Guaranteed availability'   },
  ];

  constructor(private router: Router, private http: HttpClient) {}

  ngOnInit() {}

  @HostListener('window:scroll')
  onScroll() { this.isScrolled = window.scrollY > 40; }

  scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  quickTrack() {
    if (this.trackNo.trim()) {
      this.router.navigate(['/track'], { queryParams: { q: this.trackNo.trim() } });
    }
  }

  sendContact() {
    // Reset all states first
    this.contactError   = '';
    this.contactSent    = false;
    this.contactSending = false;

    // Validate
    if (!this.contact.firstName.trim()) {
      this.contactError = 'Full name is required.';
      return;
    }
    if (!this.contact.email.trim()) {
      this.contactError = 'Email address is required.';
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.contact.email.trim())) {
      this.contactError = 'Please enter a valid email address.';
      return;
    }
    if (!this.contact.message.trim()) {
      this.contactError = 'Message is required.';
      return;
    }

    // All good — start sending
    this.contactSending = true;

    const body = {
      firstName: this.contact.firstName.trim(),
      lastName:  this.contact.lastName.trim(),
      email:     this.contact.email.trim(),
      message:   this.contact.message.trim(),
    };

    this.http.post(`${environment.apiUrl}/contact/`, body)
      .subscribe({
        next: (_res: any) => {
          this.contactSending = false;
          this.contactSent    = true;
          this.contactError   = '';
          this.contact        = { firstName: '', lastName: '', email: '', message: '' };
          setTimeout(() => { this.contactSent = false; }, 6000);
        },
        error: (err: any) => {
          this.contactSending = false;
          this.contactSent    = false;

          if (err.status === 0) {
            this.contactError = 'Cannot connect to server. Make sure Django is running on port 8000.';
          } else if (err.status === 400) {
            const e = err?.error;
            if (e && typeof e === 'object') {
              const key = Object.keys(e)[0];
              const msg = Array.isArray(e[key]) ? e[key][0] : e[key];
              this.contactError = msg;
            } else {
              this.contactError = 'Invalid data. Please check your inputs.';
            }
          } else if (err.status >= 500) {
            this.contactError = 'Server error. Please try again in a few minutes.';
          } else {
            this.contactError = err?.error?.error
              || err?.error?.message
              || err?.error?.detail
              || 'Failed to send. Please try again.';
          }

          setTimeout(() => { this.contactError = ''; }, 8000);
        }
      });
  }
}
