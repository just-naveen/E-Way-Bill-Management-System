import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class AppComponent implements OnInit, OnDestroy {

  private tokenCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private router: Router) {}

  ngOnInit() {
    this.checkTokenExpiry();

    // Re-check every 5 minutes while app is open
    this.tokenCheckInterval = setInterval(() => {
      this.checkTokenExpiry();
    }, 5 * 60 * 1000);
  }

  ngOnDestroy() {
    if (this.tokenCheckInterval) {
      clearInterval(this.tokenCheckInterval);
      this.tokenCheckInterval = null;
    }
  }

  private checkTokenExpiry() {
    const token = localStorage.getItem('access_token');

    // No token — user is not logged in, nothing to check.
    // Do NOT redirect here — they may be on the home or track page.
    if (!token) return;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        this.forceLogout();
        return;
      }

      const payload = JSON.parse(atob(parts[1]));

      if (!payload.exp) {
        this.forceLogout();
        return;
      }

      const msLeft      = (payload.exp * 1000) - Date.now();
      const minutesLeft = Math.floor(msLeft / 60000);

      if (msLeft <= 0) {
        // Token expired — only redirect if currently on a protected route
        const url = this.router.url;
        const onProtectedRoute = url.startsWith('/portal');
        this.forceLogout(onProtectedRoute);
      } else if (minutesLeft <= 5) {
        console.warn(`[Auth] Token expires in ${minutesLeft} minute(s).`);
      }

    } catch {
      // Malformed token — clear it but don't redirect unless on protected route
      const onProtectedRoute = this.router.url.startsWith('/portal');
      this.forceLogout(onProtectedRoute);
    }
  }

  private forceLogout(redirect = true) {
    if (this.tokenCheckInterval) {
      clearInterval(this.tokenCheckInterval);
      this.tokenCheckInterval = null;
    }
    localStorage.clear();
    if (redirect) {
      this.router.navigate(['/login']);
    }
  }
}
