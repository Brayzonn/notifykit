import { PrismaService } from '@/prisma/prisma.service';
import { findEmailEventJob } from './email-event-job.util';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

describe('findEmailEventJob', () => {
  const findFirst = jest.fn();
  const prisma = { job: { findFirst } } as unknown as PrismaService;

  beforeEach(() => findFirst.mockReset());

  it('returns null for a non-UUID id without querying', async () => {
    await expect(
      findEmailEventJob(prisma, 'order-991', 'cust-1'),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the customer when given', async () => {
    findFirst.mockResolvedValueOnce({ id: JOB_ID, customerId: 'cust-1' });

    await expect(findEmailEventJob(prisma, JOB_ID, 'cust-1')).resolves.toEqual({
      id: JOB_ID,
      customerId: 'cust-1',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: JOB_ID, customerId: 'cust-1' },
      select: { id: true, customerId: true },
    });
  });

  it('does not scope the lookup without a customer', async () => {
    findFirst.mockResolvedValueOnce(null);

    await findEmailEventJob(prisma, JOB_ID);

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      select: { id: true, customerId: true },
    });
  });
});
