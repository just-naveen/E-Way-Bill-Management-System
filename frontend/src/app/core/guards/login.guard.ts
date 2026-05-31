import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

// ✅ Always clears any existing session when the user navigates to /login.
// This guarantees the login form is always shown — no auto-redirect to dashboard.
export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  auth.clearSession();  // wipes localStorage + sessionStorage + BehaviorSubject
  return true;          // always allow /login through
};
