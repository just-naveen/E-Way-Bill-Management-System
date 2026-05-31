import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  email = '';
  password = '';
  error = '';
  loading = false;
  showPassword = false;
  remember = false;

  constructor(private authService: AuthService,
              private router: Router) {}

  clearError() {
    this.error = '';
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  login() {

    // ✅ Email validation
    if (!this.email) {
      this.error = 'Email is required';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email)) {
      this.error = 'Enter valid email address';
      return;
    }

    // ✅ Password validation
    if (!this.password) {
      this.error = 'Password is required';
      return;
    }

    if (this.password.length < 4) {
      this.error = 'Password must be at least 4 characters';
      return;
    }

    this.loading = true;
    this.error = '';

    this.authService.login(this.email, this.password).subscribe({

      next: () => {
        this.loading = false;
        this.router.navigate(['/portal/dashboard']);
      },

      error: (err) => {
        this.loading = false;

        // 🔥 PROFESSIONAL ERROR HANDLING
        if (err.status === 401) {
          this.error = 'Invalid email or password';
        } else if (err.status === 0) {
          this.error = 'Server not reachable';
        } else {
          this.error = 'Something went wrong. Try again.';
        }
      }
    });
  }
}
