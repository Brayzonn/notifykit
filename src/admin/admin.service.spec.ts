import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '@/prisma/prisma.service';
import { PlatformEmailStatus } from '@prisma/client';

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
