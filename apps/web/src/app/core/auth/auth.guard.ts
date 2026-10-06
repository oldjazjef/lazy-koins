import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Protected routes: wait for the session to be restored, then let in or send to login. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.isSignedIn()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** The login page: a signed-in user goes straight to the app. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.isSignedIn() ? router.createUrlTree(['/app']) : true;
};
