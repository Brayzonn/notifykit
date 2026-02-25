import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { SendGridDomainService } from '@/sendgrid/sendgrid-domain.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { createMockUser, createMockCustomer } from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockRedisService,
  type MockedPrismaService,
  type MockedRedisService,
} from '../../test/helpers/test-utils';
import { AuthProvider, CustomerPlan } from '@prisma/client';
import axios from 'axios';

jest.mock('argon2');
jest.mock('axios');

import * as argon2 from 'argon2';
const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const NEW_EMAIL_TOKEN = 'a'.repeat(64);
const OLD_EMAIL_TOKEN = 'b'.repeat(64);

const makeChangeData = (overrides: Record<string, any> = {}) => ({
  oldEmail: 'old@example.com',
  newEmail: 'new@example.com',
  newEmailToken: NEW_EMAIL_TOKEN,
  oldEmailToken: OLD_EMAIL_TOKEN,
  newEmailConfirmed: false,
  oldEmailConfirmed: false,
  ...overrides,
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('UserService', () => {
  let service: UserService;
  let prisma: MockedPrismaService;
  let redis: MockedRedisService;
  let emailService: Record<string, jest.Mock>;
  let sendGridDomainService: Record<string, jest.Mock>;
  let encryptionService: Record<string, jest.Mock>;
  let configService: { get: jest.Mock };

  const mockEmailService = {
    sendEmailChangeVerification: jest.fn(),
    sendEmailChangeConfirmation: jest.fn(),
    sendEmailChangeCancelled: jest.fn(),
    sendEmailChangeSuccess: jest.fn(),
    sendPaymentFailedEmail: jest.fn(),
  };

  const mockSendGridDomainService = {
    authenticateDomain: jest.fn(),
    validateDomain: jest.fn(),
    deleteDomain: jest.fn(),
  };

  const mockEncryptionService = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
  };

  const mockNotificationsService = { retryJob: jest.fn() };

  const mockConfigService = { get: jest.fn() };

  const mockPrismaService = createMockPrismaService();
  const mockRedisService = createMockRedisService();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: SendGridDomainService, useValue: mockSendGridDomainService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
    emailService = module.get(EmailService);
    sendGridDomainService = module.get(SendGridDomainService);
    encryptionService = module.get(EncryptionService);
    configService = module.get(ConfigService);

    configService.get.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        FRONTEND_URL: 'https://app.notifykit.dev',
      };
      return config[key];
    });

    // Re-apply implementations reset by jest.resetAllMocks()
    mockEncryptionService.encrypt.mockImplementation((v: string) => `enc:${v}`);
    mockEncryptionService.decrypt.mockImplementation((v: string) => v.replace('enc:', ''));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── getUserProfile ───────────────────────────────────────────────────────────

  describe('getUserProfile', () => {
    it('should throw NotFoundException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUserProfile('user-123')).rejects.toThrow(NotFoundException);
    });

    it('should return the user without the password field', async () => {
      const user = createMockUser({ password: 'hashed' });
      prisma.user.findUnique.mockResolvedValue({ ...user, customer: null });

      const result = await service.getUserProfile('user-123');

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe(user.id);
    });
  });

  // ── changePassword ───────────────────────────────────────────────────────────

  describe('changePassword', () => {
    const dto = { currentPassword: 'old-pass', newPassword: 'new-pass' };

    it('should throw NotFoundException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('user-123', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for OAuth users', async () => {
      prisma.user.findUnique.mockResolvedValue(
        createMockUser({ provider: AuthProvider.GITHUB }),
      );
      await expect(service.changePassword('user-123', dto)).rejects.toThrow(
        'Password change is only available for email authentication',
      );
    });

    it('should throw BadRequestException when user has no password set', async () => {
      prisma.user.findUnique.mockResolvedValue(
        createMockUser({ provider: AuthProvider.EMAIL, password: null }),
      );
      await expect(service.changePassword('user-123', dto)).rejects.toThrow(
        'User has no password set',
      );
    });

    it('should throw UnauthorizedException for an incorrect current password', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ provider: AuthProvider.EMAIL }));
      mockedArgon2.verify.mockResolvedValue(false);

      await expect(service.changePassword('user-123', dto)).rejects.toThrow(
        'Current password is incorrect',
      );
    });

    it('should hash the new password and update the user', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ provider: AuthProvider.EMAIL }));
      mockedArgon2.verify.mockResolvedValue(true);
      mockedArgon2.hash.mockResolvedValue('new-hashed-password');

      await service.changePassword('user-123', dto);

      expect(argon2.hash).toHaveBeenCalledWith('new-pass');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { password: 'new-hashed-password' },
      });
    });

    it('should invalidate the Redis cache and return success', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ provider: AuthProvider.EMAIL }));
      mockedArgon2.verify.mockResolvedValue(true);
      mockedArgon2.hash.mockResolvedValue('new-hashed');

      const result = await service.changePassword('user-123', dto);

      expect(redis.del).toHaveBeenCalledWith('user:user-123');
      expect(result).toEqual({ message: 'Password changed successfully' });
    });
  });

  // ── requestEmailChange ───────────────────────────────────────────────────────

  describe('requestEmailChange', () => {
    const dto = {
      newEmail: 'new@example.com',
      password: 'my-password',
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValueOnce(
        createMockUser({ id: 'user-123', email: 'old@example.com', provider: AuthProvider.EMAIL }),
      );
      // Second findUnique: new email not taken
      prisma.user.findUnique.mockResolvedValueOnce(null);
      mockedArgon2.verify.mockResolvedValue(true);
      redis.set.mockResolvedValue(undefined);
      mockEmailService.sendEmailChangeVerification.mockResolvedValue(undefined);
      mockEmailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);
    });

    it('should throw NotFoundException when user is not found', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.requestEmailChange('user-123', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when password is missing for EMAIL provider', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValue(
        createMockUser({ provider: AuthProvider.EMAIL }),
      );

      await expect(
        service.requestEmailChange('user-123', { newEmail: 'new@example.com' }),
      ).rejects.toThrow('Password is required');
    });

    it('should throw UnauthorizedException for a wrong password', async () => {
      mockedArgon2.verify.mockResolvedValue(false);

      await expect(service.requestEmailChange('user-123', dto)).rejects.toThrow(
        'Password is incorrect',
      );
    });

    it('should throw BadRequestException when the new email is already in use', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique
        .mockResolvedValueOnce(createMockUser({ provider: AuthProvider.EMAIL }))
        .mockResolvedValueOnce(createMockUser({ email: dto.newEmail })); // taken

      await expect(service.requestEmailChange('user-123', dto)).rejects.toThrow(
        'Email already in use',
      );
    });

    it('should store change data and both tokens in Redis', async () => {
      await service.requestEmailChange('user-123', dto);

      // email-change key + two token keys = 3 set calls
      expect(redis.set).toHaveBeenCalledTimes(3);
      expect(redis.set).toHaveBeenCalledWith(
        'email-change:user-123',
        expect.stringContaining('"newEmail":"new@example.com"'),
        1800,
      );
    });

    it('should send verification to new email and confirmation to old email', async () => {
      await service.requestEmailChange('user-123', dto);

      expect(emailService.sendEmailChangeVerification).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      expect(emailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'old@example.com', newEmail: 'new@example.com' }),
      );
    });

    it('should skip password check for OAuth provider users', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique
        .mockResolvedValueOnce(createMockUser({ provider: AuthProvider.GITHUB }))
        .mockResolvedValueOnce(null);

      await expect(
        service.requestEmailChange('user-123', { newEmail: 'new@example.com' }),
      ).resolves.toBeDefined();

      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('should return message and expiresIn: 1800', async () => {
      const result = await service.requestEmailChange('user-123', dto);

      expect(result).toMatchObject({ expiresIn: 1800 });
      expect(result.message).toBeDefined();
    });
  });

  // ── verifyNewEmail ───────────────────────────────────────────────────────────

  describe('verifyNewEmail', () => {
    it('should throw UnauthorizedException for an invalid or expired token', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.verifyNewEmail('bad-token')).rejects.toThrow(
        'Invalid or expired verification token',
      );
    });

    it('should throw UnauthorizedException when the email change request is not found', async () => {
      redis.get.mockResolvedValueOnce('user-123').mockResolvedValueOnce(null);

      await expect(service.verifyNewEmail(NEW_EMAIL_TOKEN)).rejects.toThrow(
        'Email change request not found',
      );
    });

    it('should throw UnauthorizedException for a mismatched token', async () => {
      const data = makeChangeData({ newEmailToken: 'different-token' });
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));

      await expect(service.verifyNewEmail(NEW_EMAIL_TOKEN)).rejects.toThrow(
        'Invalid verification token',
      );
    });

    it('should mark newEmailConfirmed and update Redis', async () => {
      const data = makeChangeData();
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));

      await service.verifyNewEmail(NEW_EMAIL_TOKEN);

      const setCall = redis.set.mock.calls.find(([key]) =>
        key === 'email-change:user-123',
      );
      expect(setCall).toBeDefined();
      const saved = JSON.parse(setCall![1]);
      expect(saved.newEmailConfirmed).toBe(true);
    });

    it('should complete the email change when both sides have confirmed', async () => {
      const data = makeChangeData({ oldEmailConfirmed: true }); // old already confirmed
      redis.get
        .mockResolvedValueOnce('user-123')        // token lookup
        .mockResolvedValueOnce(JSON.stringify(data)) // change data for verify
        .mockResolvedValueOnce(JSON.stringify(data)); // change data inside completeEmailChange

      prisma.user.update.mockResolvedValue(createMockUser());
      prisma.customer.update.mockResolvedValue(createMockCustomer());
      mockEmailService.sendEmailChangeSuccess.mockResolvedValue(undefined);

      const result = await service.verifyNewEmail(NEW_EMAIL_TOKEN);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { email: 'new@example.com', emailVerified: true } }),
      );
      expect(result.bothConfirmed).toBe(true);
    });
  });

  // ── confirmOldEmail ──────────────────────────────────────────────────────────

  describe('confirmOldEmail', () => {
    it('should throw UnauthorizedException for an invalid token', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.confirmOldEmail('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should mark oldEmailConfirmed in Redis', async () => {
      const data = makeChangeData();
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));

      await service.confirmOldEmail(OLD_EMAIL_TOKEN);

      const setCall = redis.set.mock.calls.find(([key]) =>
        key === 'email-change:user-123',
      );
      const saved = JSON.parse(setCall![1]);
      expect(saved.oldEmailConfirmed).toBe(true);
    });

    it('should return bothConfirmed: false when new email is not yet verified', async () => {
      const data = makeChangeData();
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));

      const result = await service.confirmOldEmail(OLD_EMAIL_TOKEN);

      expect(result.bothConfirmed).toBe(false);
    });
  });

  // ── cancelEmailChange ────────────────────────────────────────────────────────

  describe('cancelEmailChange', () => {
    it('should throw UnauthorizedException for an invalid token', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.cancelEmailChange('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete all three Redis keys', async () => {
      const data = makeChangeData();
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));
      mockEmailService.sendEmailChangeCancelled.mockResolvedValue(undefined);

      await service.cancelEmailChange(OLD_EMAIL_TOKEN);

      expect(redis.del).toHaveBeenCalledWith('email-change:user-123');
      expect(redis.del).toHaveBeenCalledWith(`token:${NEW_EMAIL_TOKEN}`);
      expect(redis.del).toHaveBeenCalledWith(`token:${OLD_EMAIL_TOKEN}`);
    });

    it('should send a cancellation email to the old address', async () => {
      const data = makeChangeData();
      redis.get
        .mockResolvedValueOnce('user-123')
        .mockResolvedValueOnce(JSON.stringify(data));
      mockEmailService.sendEmailChangeCancelled.mockResolvedValue(undefined);

      await service.cancelEmailChange(OLD_EMAIL_TOKEN);

      expect(emailService.sendEmailChangeCancelled).toHaveBeenCalledWith({
        email: 'old@example.com',
        newEmail: 'new@example.com',
      });
    });
  });

  // ── deleteAccount ────────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('should throw NotFoundException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAccount('user-123', 'me@example.com')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw UnauthorizedException when the confirm email does not match', async () => {
      prisma.user.findUnique.mockResolvedValue(
        createMockUser({ email: 'real@example.com' }),
      );

      await expect(service.deleteAccount('user-123', 'wrong@example.com')).rejects.toThrow(
        'Email confirmation does not match',
      );
    });

    it('should soft-delete the user by setting deletedAt', async () => {
      const user = createMockUser({ email: 'me@example.com' });
      prisma.user.findUnique.mockResolvedValue(user);

      await service.deleteAccount('user-123', 'me@example.com');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should deactivate the customer and delete all refresh tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ email: 'me@example.com' }));

      await service.deleteAccount('user-123', 'me@example.com');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { isActive: false },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should invalidate the Redis cache and return a success message', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ email: 'me@example.com' }));

      const result = await service.deleteAccount('user-123', 'me@example.com');

      expect(redis.del).toHaveBeenCalledWith('user:user-123');
      expect(result).toEqual({ message: 'Account deleted successfully' });
    });
  });

  // ── getApiKey ────────────────────────────────────────────────────────────────

  describe('getApiKey', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getApiKey('user-123')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when no API key has been generated yet', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ apiKey: null, apiKeyHash: null }),
      );

      await expect(service.getApiKey('user-123')).rejects.toThrow(
        'No API key generated yet',
      );
    });

    it('should return the plaintext key on first reveal and null it in DB', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          apiKey: 'nh_plaintextkey1234',
          apiKeyHash: 'somehash',
        }),
      );

      const result = await service.getApiKey('user-123');

      expect(result).toMatchObject({ apiKey: 'nh_plaintextkey1234', firstTime: true });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { apiKey: null },
      });
    });

    it('should return a masked key on subsequent requests', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ apiKey: null, apiKeyHash: 'somehash', apiKeyLastFour: 'abcd' }),
      );

      const result = await service.getApiKey('user-123');

      expect(result.apiKey).toMatch(/nh_•+abcd$/);
      expect(result).toMatchObject({ masked: true });
    });
  });

  // ── regenerateApiKey ─────────────────────────────────────────────────────────

  describe('regenerateApiKey', () => {
    it('should throw BadRequestException when confirm email does not match', async () => {
      await expect(
        service.regenerateApiKey('user-123', 'me@example.com', 'wrong@example.com'),
      ).rejects.toThrow('Confirmation email does not match');
    });

    it('should throw NotFoundException when user or customer is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.regenerateApiKey('user-123', 'me@example.com', 'me@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should generate a new nh_ prefixed key and persist it', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...createMockUser(),
        customer: createMockCustomer(),
      });

      const result = await service.regenerateApiKey(
        'user-123',
        'me@example.com',
        'me@example.com',
      );

      expect(result.apiKey).toMatch(/^nh_[0-9a-f]{64}$/);
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKey: expect.stringMatching(/^nh_/),
            apiKeyHash: expect.any(String),
            apiKeyLastFour: expect.any(String),
          }),
        }),
      );
    });
  });

  // ── saveCustomerSendgridKey ──────────────────────────────────────────────────

  describe('saveCustomerSendgridKey', () => {
    const API_KEY = 'SG.valid_key';

    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.saveCustomerSendgridKey('user-123', API_KEY)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for FREE plan customers', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );

      await expect(service.saveCustomerSendgridKey('user-123', API_KEY)).rejects.toThrow(
        'SendGrid API key is only available for paid plans',
      );
    });

    it('should throw BadRequestException for an invalid SendGrid API key', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE }),
      );
      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(service.saveCustomerSendgridKey('user-123', API_KEY)).rejects.toThrow(
        'Invalid SendGrid API key',
      );
    });

    it('should encrypt the key before saving', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE }),
      );
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await service.saveCustomerSendgridKey('user-123', API_KEY);

      expect(encryptionService.encrypt).toHaveBeenCalledWith(API_KEY);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: {
          sendgridApiKey: `enc:${API_KEY}`,
          sendgridKeyAddedAt: expect.any(Date),
        },
      });
    });

    it('should return a success message', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE }),
      );
      mockedAxios.get.mockResolvedValue({ status: 200 });

      const result = await service.saveCustomerSendgridKey('user-123', API_KEY);

      expect(result).toEqual({ message: 'SendGrid API key saved successfully' });
    });
  });

  // ── getCustomerSendgridKey ───────────────────────────────────────────────────

  describe('getCustomerSendgridKey', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getCustomerSendgridKey('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return hasKey: true with addedAt when a key exists', async () => {
      const addedAt = new Date('2026-01-01');
      prisma.customer.findUnique.mockResolvedValue({
        sendgridApiKey: 'enc:SG.some_key',
        sendgridKeyAddedAt: addedAt,
      });

      const result = await service.getCustomerSendgridKey('user-123');

      expect(result).toEqual({ hasKey: true, addedAt, lastFour: '_key' });
    });

    it('should return hasKey: false with null addedAt when no key exists', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        sendgridApiKey: null,
        sendgridKeyAddedAt: null,
      });

      const result = await service.getCustomerSendgridKey('user-123');

      expect(result).toEqual({ hasKey: false, addedAt: null, lastFour: null });
    });
  });

  // ── removeCustomerSendgridKey ────────────────────────────────────────────────

  describe('removeCustomerSendgridKey', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.removeCustomerSendgridKey('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should null out the key fields and return a success message', async () => {
      prisma.customer.findUnique.mockResolvedValue(createMockCustomer());

      const result = await service.removeCustomerSendgridKey('user-123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { sendgridApiKey: null, sendgridKeyAddedAt: null },
      });
      expect(result).toEqual({ message: 'SendGrid API key removed successfully' });
    });
  });

  // ── requestDomainVerification ────────────────────────────────────────────────

  describe('requestDomainVerification', () => {
    const DOMAIN = 'mail.example.com';
    const mockAuthResult = {
      domainId: 12345,
      dnsRecords: [
        { type: 'cname', host: 'em.mail.example.com', value: 'sendgrid.net' },
        { type: 'cname', host: 'dkim1._domainkey.mail.example.com', value: 'dkim1.sendgrid.net' },
        { type: 'cname', host: 'dkim2._domainkey.mail.example.com', value: 'dkim2.sendgrid.net' },
      ],
      valid: false,
    };

    beforeEach(() => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE, sendgridDomainId: null }),
      );
      prisma.customer.findFirst.mockResolvedValue(null); // domain not taken
      mockSendGridDomainService.authenticateDomain.mockResolvedValue(mockAuthResult);
    });

    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.requestDomainVerification('user-123', DOMAIN)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for FREE plan', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );

      await expect(service.requestDomainVerification('user-123', DOMAIN)).rejects.toThrow(
        'Custom domain is only available for paid plans',
      );
    });

    it('should throw BadRequestException for an invalid domain format', async () => {
      await expect(
        service.requestDomainVerification('user-123', 'not a valid domain!!'),
      ).rejects.toThrow('Invalid domain format');
    });

    it('should throw BadRequestException when the domain is already verified by another customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(createMockCustomer()); // domain taken

      await expect(service.requestDomainVerification('user-123', DOMAIN)).rejects.toThrow(
        'This domain is already verified by another customer',
      );
    });

    it('should delete the old SendGrid domain before authenticating a new one', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE, sendgridDomainId: '999' }),
      );
      mockSendGridDomainService.deleteDomain.mockResolvedValue(undefined);

      await service.requestDomainVerification('user-123', DOMAIN);

      expect(sendGridDomainService.deleteDomain).toHaveBeenCalledWith(999);
    });

    it('should call authenticateDomain and save the result to DB', async () => {
      await service.requestDomainVerification('user-123', DOMAIN);

      expect(sendGridDomainService.authenticateDomain).toHaveBeenCalledWith(DOMAIN);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: expect.objectContaining({
          sendingDomain: DOMAIN,
          sendgridDomainId: '12345',
          domainVerified: false,
          domainRequestedAt: expect.any(Date),
        }),
      });
    });

    it('should return domain, status pending, and DNS records', async () => {
      const result = await service.requestDomainVerification('user-123', DOMAIN);

      expect(result.domain).toBe(DOMAIN);
      expect(result.status).toBe('pending');
      expect(result.dnsRecords).toHaveLength(3);
      expect(result.dnsRecords[0]).toMatchObject({ id: 1, type: 'cname' });
    });
  });

  // ── getDomainStatus ──────────────────────────────────────────────────────────

  describe('getDomainStatus', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getDomainStatus('user-123')).rejects.toThrow(NotFoundException);
    });

    it('should return status: false when no domain is configured', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ sendingDomain: null }),
      );

      const result = await service.getDomainStatus('user-123');

      expect(result).toEqual({ status: false, message: 'No custom domain configured' });
    });

    it('should return full domain info when a domain is configured', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          sendingDomain: 'mail.example.com',
          domainVerified: true,
        }),
      );

      const result = await service.getDomainStatus('user-123');

      expect(result).toMatchObject({ domain: 'mail.example.com', verified: true, status: 'verified' });
    });
  });

  // ── removeDomain ─────────────────────────────────────────────────────────────

  describe('removeDomain', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.removeDomain('user-123')).rejects.toThrow(NotFoundException);
    });

    it('should call deleteDomain when sendgridDomainId is set', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ sendgridDomainId: '999' }),
      );
      mockSendGridDomainService.deleteDomain.mockResolvedValue(undefined);

      await service.removeDomain('user-123');

      expect(sendGridDomainService.deleteDomain).toHaveBeenCalledWith(999);
    });

    it('should clear all domain fields and return success', async () => {
      prisma.customer.findUnique.mockResolvedValue(createMockCustomer());

      const result = await service.removeDomain('user-123');

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sendingDomain: null,
            domainVerified: false,
            sendgridDomainId: null,
          }),
        }),
      );
      expect(result).toEqual({ message: 'Domain removed successfully' });
    });
  });
});
