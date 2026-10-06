/**
 * The app's view of a person. Hand-written — never a re-export of a generated Prisma model (see
 * CLAUDE.md, "Persistence architecture").
 */
export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** `google.com`, `password`, `dev`, `local`, … — how the identity was proven. */
  readonly signInProvider: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the auth guard needs about the account behind a token, on every request. */
export interface PrincipalRecord {
  readonly id: string;
}

/** The claims a verified identity token carries — the input for creating or refreshing a user. */
export interface VerifiedIdentity {
  /** Firebase uid, `dev:<email>` or `local:owner`. */
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly signInProvider: string;
}

/** Fallback display name when the identity provider supplies none. */
export function displayNameFor(identity: VerifiedIdentity): string {
  const fromName = identity.name?.trim();
  if (fromName) return fromName;
  const localPart = identity.email?.split('@')[0]?.trim();
  return localPart || 'Benutzer';
}
