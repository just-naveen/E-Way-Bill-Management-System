import { Routes } from '@angular/router';
import { authGuard }  from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { staffGuard } from './core/guards/staff.guard';
import { loginGuard } from './core/guards/login.guard';

// Public pages (no layout)
import { HomeComponent }  from './pages/home/home.component';
import { TrackComponent } from './pages/track/track.component';
import { LoginComponent } from './pages/login/login.component';

// Shared layout wrapper
import { LayoutComponent } from './shared/layout/layout.component';

// Inner pages (rendered inside layout)
import { Dashboard }            from './pages/dashboard/dashboard';
import { Consignment }          from './pages/consignment/consignment';
import { Ewaybill }             from './pages/ewaybill/ewaybill';
import { Customer }             from './pages/customer/customer';
import { Vehicle }              from './pages/vehicle/vehicle';
import { Transporter }          from './pages/transporter/transporter';
import { Reports }              from './pages/reports/reports';
import { UsersComponent }       from './pages/users/users';
import { EmailAlertsComponent } from './pages/email-alerts/email-alerts'; // ← NEW

export const routes: Routes = [
  // ── PUBLIC (no sidebar/navbar) ──────────────────────────────
  { path: '',      component: HomeComponent,  pathMatch: 'full' },
  { path: 'track', component: TrackComponent },
  { path: 'login', component: LoginComponent, canActivate: [loginGuard] },

  // ── PROTECTED — all wrapped in LayoutComponent ──────────────
  {
    path: 'portal',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

      // All logged-in roles
      { path: 'dashboard',    component: Dashboard },

      // Admin + Staff
      { path: 'consignment',  component: Consignment,    canActivate: [staffGuard] },
      { path: 'ewaybill',     component: Ewaybill,       canActivate: [staffGuard] },
      { path: 'customers',    component: Customer,       canActivate: [staffGuard] },
      { path: 'vehicles',     component: Vehicle,        canActivate: [staffGuard] },
      { path: 'transporters', component: Transporter,    canActivate: [staffGuard] },

      // Admin only
      { path: 'reports',       component: Reports,              canActivate: [adminGuard] },
      { path: 'users',         component: UsersComponent,       canActivate: [adminGuard] },
      { path: 'email-alerts',  component: EmailAlertsComponent, canActivate: [adminGuard] }, // ← NEW
    ]
  },

  // ── FALLBACK ────────────────────────────────────────────────
  { path: '**', redirectTo: '' },
];
