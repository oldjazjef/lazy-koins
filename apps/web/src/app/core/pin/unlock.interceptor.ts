import {
  HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { isApiRequest } from '../api/api-url';
import { runtimeEnv } from '../config/runtime-env';
import { PinLockService, UNLOCK_HEADER } from './pin-lock.service';

/** API paths that answer while locked — they never wait for the PIN. */
const EXEMPT = /^\/api\/(pin\/|me$|version$|health$)/;

/** Whether a request may go out while the app is locked (the lock's own calls, `/me`). */
export function isLockExempt(url: string): boolean {
  const base = runtimeEnv().apiBaseUrl;
  const path = (url.startsWith(base) ? url.slice(base.length) : url).split(
    '?',
  )[0];
  return EXEMPT.test(path ?? '');
}

function withToken(
  request: HttpRequest<unknown>,
  token: string | null,
): HttpRequest<unknown> {
  return token && !request.headers.has(UNLOCK_HEADER)
    ? request.clone({ setHeaders: { [UNLOCK_HEADER]: token } })
    : request;
}

function isPinLocked(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 423 &&
    (error.error as { code?: unknown } | null)?.code === 'pinLocked'
  );
}

/**
 * F11.0p: sends the unlock token with every API request, holds data requests while the app is
 * locked, and turns a 423 (`pinLocked` — the session expired, the desktop shell locked) into the
 * lock screen; the request is sent again once the PIN was entered. The lock's own endpoints and
 * `/me` pass straight through.
 */
export const unlockInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiRequest(request.url)) return next(request);
  const pin = inject(PinLockService);
  if (isLockExempt(request.url)) return next(withToken(request, pin.token()));
  const send = (handler: HttpHandlerFn) =>
    from(pin.whenUnlocked()).pipe(
      switchMap(() => handler(withToken(request, pin.token()))),
    );
  return send(next).pipe(
    catchError((error: unknown) => {
      if (!isPinLocked(error)) return throwError(() => error);
      pin.markLocked();
      return send(next);
    }),
  );
};
