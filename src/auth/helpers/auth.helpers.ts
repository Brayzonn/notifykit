import { User } from '@prisma/client';

export type SanitizedUser = Omit<User, 'password' | 'providerId'>;

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function sanitizeUser(user: User): SanitizedUser {
  const { password, providerId, ...sanitizedUser } = user;
  return sanitizedUser;
}
