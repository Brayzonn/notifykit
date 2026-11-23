import { isUUID } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';

export interface EmailEventJob {
  id: string;
  customerId: string;
}

export const findEmailEventJob = async (
  prisma: PrismaService,
  jobId: string,
  customerId?: string,
): Promise<EmailEventJob | null> => {
  if (!isUUID(jobId)) return null;

  return prisma.job.findFirst({
    where: { id: jobId, ...(customerId ? { customerId } : {}) },
    select: { id: true, customerId: true },
  });
};
