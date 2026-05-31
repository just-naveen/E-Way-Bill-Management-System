import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Allows access to admin AND staff roles.
// Customers (viewers) hitting these routes → redirected to /dashboard.
export const staffGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.createUrlTree(['/login']);
  }

  // isOperator() returns true for both 'admin' and 'staff'
  if (auth.isOperator()) {
    return true;
  }

  // Customer/viewer role → back to their dashboard
  return router.createUrlTree(['/portal/dashboard']);
};
