import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {

  email        = '';
  password     = '';
  error        = '';
  loading      = false;
  showPassword = false;
  remember     = false;

  constructor(private authService: AuthService, private router: Router) {
    // ❌ REMOVED: the old auto-redirect that was here caused the bug.
    // Never redirect away from /login inside the constructor —
    // it fires before guards can act and bypasses the login form.
  }

  ngOnInit(): void {
    // ✅ Wipe any stored tokens the moment /login is visited.
    // This guarantees the form is always shown, regardless of what
    // was left in localStorage from a previous session.
    this.authService.clearSession();
  }

  clearError(): void {
    this.error = '';
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  login(): void {
    if (this.loading) return;

    // Validate
    if (!this.email.trim()) {
      this.error = 'Email address is required.';
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email.trim())) {
      this.error = 'Please enter a valid email address.';
      return;
    }
    if (!this.password) {
      this.error = 'Password is required.';
      return;
    }
    if (this.password.length < 4) {
      this.error = 'Password must be at least 4 characters.';
      return;
    }

    this.loading = true;
    this.error   = '';

    this.authService.login(this.email.trim(), this.password).subscribe({
      next: () => {
        this.loading = false;

        // If "Remember me" is unchecked, move tokens to sessionStorage
        // so they are cleared automatically when the tab/browser closes.
        if (!this.remember) {
          this.authService.moveTokensToSession();
        }

        this.router.navigate(['/portal/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        if      (err.status === 401) this.error = 'Invalid email or password.';
        else if (err.status === 403) this.error = 'Access denied. Contact your administrator.';
        else if (err.status === 0)   this.error = 'Cannot reach the server. Please try again.';
        else                         this.error = 'Login failed. Please try again.';
      }
    });
  }
}
