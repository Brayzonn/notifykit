import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

const VALID_KEY = 'a'.repeat(64);

const createConfigService = (key: string | undefined) => ({
  get: jest.fn((k: string) => (k === 'ENCRYPTION_KEY' ? key : undefined)),
});

describe('EncryptionService', () => {
  const buildService = async (
    key: string | undefined,
  ): Promise<EncryptionService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: createConfigService(key) },
      ],
    }).compile();
    return module.get<EncryptionService>(EncryptionService);
  };

  describe('Initialisation', () => {
    it('should initialise successfully with a valid 64-char hex key', async () => {
      await expect(buildService(VALID_KEY)).resolves.toBeDefined();
    });

    it('should throw when ENCRYPTION_KEY is missing', async () => {
      await expect(buildService(undefined)).rejects.toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string',
      );
    });

    it('should throw when ENCRYPTION_KEY is too short', async () => {
      await expect(buildService('a'.repeat(32))).rejects.toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string',
      );
    });

    it('should throw when ENCRYPTION_KEY is too long', async () => {
      await expect(buildService('a'.repeat(128))).rejects.toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string',
      );
    });
  });

  describe('encrypt', () => {
    let service: EncryptionService;

    beforeEach(async () => {
      service = await buildService(VALID_KEY);
    });

    it('should return a string in the format "iv:ciphertext:authTag"', () => {
      const result = service.encrypt('hello');
      const parts = result.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(24);
      expect(parts[1].length).toBeGreaterThan(0);
      expect(parts[2]).toHaveLength(32);
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', () => {
      const a = service.encrypt('same input');
      const b = service.encrypt('same input');
      expect(a).not.toBe(b);
    });

    it('should produce hex-encoded output', () => {
      const result = service.encrypt('test');
      const [iv, ciphertext, authTag] = result.split(':');
      expect(iv).toMatch(/^[0-9a-f]+$/);
      expect(ciphertext).toMatch(/^[0-9a-f]+$/);
      expect(authTag).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('decrypt', () => {
    let service: EncryptionService;

    beforeEach(async () => {
      service = await buildService(VALID_KEY);
    });

    it('should decrypt back to the original plaintext', () => {
      const plaintext = 'SG.my_sendgrid_api_key';
      const encrypted = service.encrypt(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('should handle strings with special characters', () => {
      const plaintext = 'key with spaces & symbols: !@#$%^&*()';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'SG.' + 'x'.repeat(200);
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('should reject a tampered ciphertext', () => {
      const [iv, ciphertext, authTag] = service.encrypt('secret').split(':');
      const flipped =
        (parseInt(ciphertext[0], 16) ^ 1).toString(16) + ciphertext.slice(1);
      expect(() => service.decrypt(`${iv}:${flipped}:${authTag}`)).toThrow();
    });

    it('should reject a tampered auth tag', () => {
      const [iv, ciphertext, authTag] = service.encrypt('secret').split(':');
      const flipped =
        (parseInt(authTag[0], 16) ^ 1).toString(16) + authTag.slice(1);
      expect(() => service.decrypt(`${iv}:${ciphertext}:${flipped}`)).toThrow();
    });

    it('should reject data encrypted under a different key', async () => {
      const other = await buildService('b'.repeat(64));
      expect(() => service.decrypt(other.encrypt('secret'))).toThrow();
    });

    it('should reject the legacy 2-part CBC format', () => {
      const legacy = `${'0'.repeat(32)}:${'ab'.repeat(16)}`;
      expect(() => service.decrypt(legacy)).toThrow();
    });
  });

  describe('round-trip integrity', () => {
    it('should correctly round-trip a typical SendGrid API key', async () => {
      const service = await buildService(VALID_KEY);
      const apiKey = 'SG.abcDEF123_realLookingKey.XYZ';
      expect(service.decrypt(service.encrypt(apiKey))).toBe(apiKey);
    });

    it('should be deterministically reversible across multiple encrypt/decrypt cycles', async () => {
      const service = await buildService(VALID_KEY);
      const original = 'test-value-123';
      const enc1 = service.encrypt(original);
      const enc2 = service.encrypt(original);
      expect(service.decrypt(enc1)).toBe(original);
      expect(service.decrypt(enc2)).toBe(original);
    });
  });
});
