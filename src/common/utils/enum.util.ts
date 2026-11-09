import { JobStatus } from '@/generated/prisma/client';

export const toApiStatus = (status: JobStatus): string => {
  return status.toLowerCase();
};
