import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { PlatformEmailStatus } from '@prisma/client';

// Convenience: build a stats payload matching getStats() return shape.
const makeStats = (overrides: Partial<Record<string, any>> = {}) => ({
  users: { total: 10, active: 8, deleted: 2 },
  customers: { total: 5, active: 4, byPlan: { FREE: 3, INDIE: 1, STARTUP: 1 } },
  jobs: { total: 100, pending: 5, processing: 2, completed: 90, failed: 3 },
  ...overrides,
});

const makeLog = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'log-uuid-1',
  label: 'otp',
  to: 'user@example.com',
  subject: 'Verify your email',
  status: PlatformEmailStatus.SENT,
  attempts: 1,
  errorMessage: null,
  sentAt: new Date('2026-05-14T10:00:00Z'),
  createdAt: new Date('2026-05-14T10:00:00Z'),
  updatedAt: new Date('2026-05-14T10:00:00Z'),
  ...overrides,
});

describe('AdminService — platform email logs', () => {
  let service: AdminService;
  let prisma: { platformEmailLog: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; delete: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      platformEmailLog: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RedisService,
          useValue: {
            del: jest.fn(),
            // Invoke the callback by default so tests that don't care about
            // caching still exercise the real service logic.
            remember: jest.fn().mockImplementation((_key, _ttl, cb) => cb()),
          },
        },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  // ── getPlatformEmailLogs ───────────────────────────────────────────────────

  describe('getPlatformEmailLogs', () => {
    it('returns paginated logs with no filters', async () => {
      prisma.platformEmailLog.findMany.mockResolvedValue([makeLog()]);
      prisma.platformEmailLog.count.mockResolvedValue(1);

      const result = await service.getPlatformEmailLogs({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(prisma.platformEmailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
    });

    it('applies status filter', async () => {
      prisma.platformEmailLog.findMany.mockResolvedValue([]);
      prisma.platformEmailLog.count.mockResolvedValue(0);

      await service.getPlatformEmailLogs({ status: PlatformEmailStatus.FAILED });

      expect(prisma.platformEmailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: PlatformEmailStatus.FAILED } }),
      );
    });

    it('applies label filter', async () => {
      prisma.platformEmailLog.findMany.mockResolvedValue([]);
      prisma.platformEmailLog.count.mockResolvedValue(0);

      await service.getPlatformEmailLogs({ label: 'otp' });

      expect(prisma.platformEmailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { label: 'otp' } }),
      );
    });

    it('applies recipient email search', async () => {
      prisma.platformEmailLog.findMany.mockResolvedValue([]);
      prisma.platformEmailLog.count.mockResolvedValue(0);

      await service.getPlatformEmailLogs({ search: 'john' });

      expect(prisma.platformEmailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { to: { contains: 'john', mode: 'insensitive' } },
        }),
      );
    });

    it('calculates skip correctly for page 2', async () => {
      prisma.platformEmailLog.findMany.mockResolvedValue([]);
      prisma.platformEmailLog.count.mockResolvedValue(0);

      await service.getPlatformEmailLogs({ page: 2, limit: 10 });

      expect(prisma.platformEmailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  // ── getPlatformEmailLogById ───────────────────────────────────────────────

  describe('getPlatformEmailLogById', () => {
    it('returns the log when found', async () => {
      const log = makeLog();
      prisma.platformEmailLog.findUnique.mockResolvedValue(log);

      const result = await service.getPlatformEmailLogById('log-uuid-1');

      expect(result).toEqual(log);
      expect(prisma.platformEmailLog.findUnique).toHaveBeenCalledWith({
        where: { id: 'log-uuid-1' },
      });
    });

    it('throws NotFoundException when log does not exist', async () => {
      prisma.platformEmailLog.findUnique.mockResolvedValue(null);
      await expect(service.getPlatformEmailLogById('no-such-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── deletePlatformEmailLog ────────────────────────────────────────────────

  describe('deletePlatformEmailLog', () => {
    it('deletes the log and returns confirmation', async () => {
      const log = makeLog();
      prisma.platformEmailLog.findUnique.mockResolvedValue(log);
      prisma.platformEmailLog.delete.mockResolvedValue(log);

      const result = await service.deletePlatformEmailLog('log-uuid-1');

      expect(prisma.platformEmailLog.delete).toHaveBeenCalledWith({
        where: { id: 'log-uuid-1' },
      });
      expect(result).toEqual({ message: 'Platform email log deleted successfully', id: 'log-uuid-1' });
    });

    it('throws NotFoundException when log does not exist', async () => {
      prisma.platformEmailLog.findUnique.mockResolvedValue(null);
      await expect(service.deletePlatformEmailLog('no-such-id')).rejects.toThrow(NotFoundException);
      expect(prisma.platformEmailLog.delete).not.toHaveBeenCalled();
    });
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('AdminService — getStats', () => {
  let service: AdminService;
  let redis: { del: jest.Mock; remember: jest.Mock };
  let prisma: {
    user: { count: jest.Mock };
    customer: { count: jest.Mock };
    job: { count: jest.Mock };
    platformEmailLog: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn() },
      customer: { count: jest.fn() },
      job: { count: jest.fn() },
      platformEmailLog: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    redis = {
      del: jest.fn(),
      remember: jest.fn().mockImplementation((_key, _ttl, cb) => cb()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  it('runs all 13 counts on a cache miss and returns shaped stats', async () => {
    // remember invokes the callback (cache miss behaviour) — set up counts.
    prisma.user.count.mockResolvedValue(10);
    prisma.customer.count.mockResolvedValue(5);
    prisma.job.count.mockResolvedValue(20);

    const result = await service.getStats();

    // remember was called with the correct key and TTL.
    expect(redis.remember).toHaveBeenCalledWith('admin:stats', 60, expect.any(Function));

    // All three Prisma models were queried.
    expect(prisma.user.count).toHaveBeenCalledTimes(3);
    expect(prisma.customer.count).toHaveBeenCalledTimes(5);
    expect(prisma.job.count).toHaveBeenCalledTimes(5);

    // Return shape is correct.
    expect(result).toMatchObject({
      users: { total: 10, active: 10, deleted: 10 },
      customers: {
        total: 5,
        active: 5,
        byPlan: { FREE: 5, INDIE: 5, STARTUP: 5 },
      },
      jobs: { total: 20, pending: 20, processing: 20, completed: 20, failed: 20 },
    });
  });

  it('returns the cached value on a hit without running any DB queries', async () => {
    const cached = makeStats();

    // Simulate a warm cache: remember returns the stored value immediately.
    redis.remember.mockResolvedValue(cached);

    const result = await service.getStats();

    expect(result).toEqual(cached);

    // No DB queries should have been made.
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(prisma.job.count).not.toHaveBeenCalled();
  });
});
