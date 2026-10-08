/**
 * The principal behind a request, as `AccessTokenGuard` leaves it on `request.user`.
 *
 * One role, platform admin, for the management pages only; everything else is "you may act on
 * what you own", checked by the handlers against `userId`. Someone else's project reads as 404.
 */
export interface AuthenticatedUser {
  /** Our own user id — never the Firebase uid. */
  readonly userId: string;
  readonly email: string;
  /** When the person signed in (ISO), if the token says — see `VerifiedIdentity.authTime`. */
  readonly authTime?: string | null;
  /** May use the management pages (`/api/admin/*`, `PlatformAdminGuard`). */
  readonly isPlatformAdmin?: boolean;
}
