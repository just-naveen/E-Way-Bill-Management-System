import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<any>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    // Restore user from whichever storage has it (persistent or session-only)
    const raw = localStorage.getItem('user') ?? sessionStorage.getItem('user');
    if (raw) {
      try { this.currentUserSubject.next(JSON.parse(raw)); } catch {}
    }
  }

  // ── LOGIN ──────────────────────────────────────────────────────────────
  login(email: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/login/`, { email, password }).pipe(
      tap((res: any) => {
        localStorage.setItem('access_token',  res.access);
        localStorage.setItem('refresh_token', res.refresh);
        localStorage.setItem('user',          JSON.stringify(res.user));
        this.currentUserSubject.next(res.user);
      })
    );
  }

  // ── CLEAR SESSION ──────────────────────────────────────────────────────
  // Called in LoginComponent.ngOnInit() so the login form ALWAYS appears.
  // Wipes tokens from both storages so isLoggedIn() returns false.
  clearSession(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('user');
    this.currentUserSubject.next(null);
  }

  // ── MOVE TOKENS TO SESSION STORAGE ────────────────────────────────────
  // Called after login when "Remember me" is NOT checked.
  // Tokens survive the current tab only — cleared when tab/browser closes.
  moveTokensToSession(): void {
    const token   = localStorage.getItem('access_token');
    const refresh = localStorage.getItem('refresh_token');
    const user    = localStorage.getItem('user');

    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');

    if (token)   sessionStorage.setItem('access_token',  token);
    if (refresh) sessionStorage.setItem('refresh_token', refresh);
    if (user)    sessionStorage.setItem('user',          user);
  }

  // ── LOGOUT ────────────────────────────────────────────────────────────
  logout(): void {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  // ── USER GETTERS ──────────────────────────────────────────────────────
  get currentUser() {
    return this.currentUserSubject.value;
  }

  getCurrentUser() {
    return this.currentUserSubject.value;
  }

  // ── AUTH CHECKS ───────────────────────────────────────────────────────
  isLoggedIn(): boolean {
    return !!(
      localStorage.getItem('access_token') ||
      sessionStorage.getItem('access_token')
    );
  }

  // Django returns lowercase role values ('admin', 'staff')
  isAdmin(): boolean {
    return this.currentUserSubject.value?.role === 'admin';
  }

  isStaff(): boolean {
    return this.currentUserSubject.value?.role === 'staff';
  }

  isOperator(): boolean {
    const role = this.currentUserSubject.value?.role;
    return role === 'admin' || role === 'staff';
  }

  // ── HEADERS ───────────────────────────────────────────────────────────
  getToken(): string | null {
    return localStorage.getItem('access_token')
        ?? sessionStorage.getItem('access_token');
  }

  getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type':  'application/json'
    });
  }
}
