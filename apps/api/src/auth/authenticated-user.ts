/**
 * The principal behind a request, as `AccessTokenGuard` leaves it on `request.user`.
 *
 * There are no roles: everything is "you may act on what you own", checked by the handlers
 * against `userId`. Someone else's project reads as 404.
 */
export interface AuthenticatedUser {
  /** Our own user id — never the Firebase uid. */
  readonly userId: string;
  readonly email: string;
}
