import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { isApiRequest } from '../api/api-url';
import { AuthService } from './auth.service';

/**
 * Attaches the bearer token to requests for our API — and only those, so a token never reaches
 * a third-party host (or the i18n files). A 401 from the API means the session is gone: sign
 * out locally and go to the login page.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiRequest(request.url)) return next(request);

  const auth = inject(AuthService);
  const router = inject(Router);

  return from(auth.token()).pipe(
    switchMap((token) =>
      next(
        token
          ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
          : request,
      ),
    ),
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        auth.isSignedIn()
      ) {
        void auth.signOut().then(() => router.navigate(['/login']));
      }
      return throwError(() => error);
    }),
  );
};
