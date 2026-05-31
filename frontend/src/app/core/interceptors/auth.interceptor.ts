import {
  HttpInterceptorFn,
  HttpErrorResponse,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, switchMap, throwError, BehaviorSubject, filter, take } from 'rxjs';
import { environment } from '../../../environments/environment';

// ── Shared refresh state (prevents multiple simultaneous refresh calls) ──
let isRefreshing = false;
const refreshDone$ = new BehaviorSubject<boolean>(false);

function addToken(req: HttpRequest<any>, token: string): HttpRequest<any> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

// ✅ Always check BOTH storages — token may be in sessionStorage
// when "Remember me" was unchecked at login.
function getToken(): string | null {
  return localStorage.getItem('access_token')
      ?? sessionStorage.getItem('access_token');
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refresh_token')
      ?? sessionStorage.getItem('refresh_token');
}

function saveAccessToken(token: string): void {
  // Save back to whichever storage currently holds the token
  if (localStorage.getItem('refresh_token')) {
    localStorage.setItem('access_token', token);
  } else {
    sessionStorage.setItem('access_token', token);
  }
}

function clearAndRedirect(router: Router): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('access_token');
  sessionStorage.removeItem('refresh_token');
  sessionStorage.removeItem('user');
  router.navigate(['/login']);
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const http   = inject(HttpClient);

  // Skip auth header for login and public track endpoint
  const isPublic = req.url.includes('/auth/login/') || req.url.includes('/track/');
  const token    = getToken(); // ✅ checks both storages

  const authReq = (token && !isPublic) ? addToken(req, token) : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {

      if (err.status !== 401 || isPublic) {
        return throwError(() => err);
      }

      const refreshToken = getRefreshToken(); // ✅ checks both storages

      if (!refreshToken) {
        clearAndRedirect(router);
        return throwError(() => err);
      }

      if (isRefreshing) {
        return refreshDone$.pipe(
          filter(done => done === true),
          take(1),
          switchMap(() => {
            const newToken = getToken() || '';
            return next(addToken(req, newToken));
          })
        );
      }

      isRefreshing = true;
      refreshDone$.next(false);

      return http.post<any>(`${environment.apiUrl}/auth/token/refresh/`, {
        refresh: refreshToken
      }).pipe(
        switchMap((res: any) => {
          saveAccessToken(res.access); // ✅ saves to correct storage
          if (res.refresh) {
            if (localStorage.getItem('refresh_token')) {
              localStorage.setItem('refresh_token', res.refresh);
            } else {
              sessionStorage.setItem('refresh_token', res.refresh);
            }
          }
          isRefreshing = false;
          refreshDone$.next(true);
          return next(addToken(req, res.access));
        }),
        catchError((refreshErr) => {
          isRefreshing = false;
          refreshDone$.next(false);
          clearAndRedirect(router);
          return throwError(() => refreshErr);
        })
      );
    })
  );
};
