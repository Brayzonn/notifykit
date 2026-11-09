import { Prisma } from '@/generated/prisma/client';

export type RefreshTokenWithUser = Prisma.RefreshTokenGetPayload<{
  include: { user: true };
}>;
