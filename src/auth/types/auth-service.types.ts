import { Prisma } from '@prisma/client';

export type RefreshTokenWithUser = Prisma.RefreshTokenGetPayload<{
  include: { user: true };
}>;
