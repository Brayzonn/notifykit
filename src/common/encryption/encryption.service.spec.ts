import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from './encryption.service';
import { ConfigService } from '@nestjs/config';

// A valid 64-character hex string (32 bytes) for testing
const VALID_KEY = 'a'.repeat(64);

const createConfigService = (key: string | undefined) => ({
  get: jest.fn((k: string) => (k === 'ENCRYPTION_KEY' ? key : undefined)),
});

describe('EncryptionService', () => {
  const buildService = async (key: string | undefined): Promise<EncryptionService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: createConfigService(key) },
      ],
    }).compile();
    return module.get<EncryptionService>(EncryptionService);
  };

  // ── Initialisation ───────────────────────────────────────────────────────────

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

  // ── Encrypt ──────────────────────────────────────────────────────────────────

  describe('encrypt', () => {
    let service: EncryptionService;

    beforeEach(async () => {
      service = await buildService(VALID_KEY);
    });

    it('should return a string in the format "iv:ciphertext"', () => {
      const result = service.encrypt('hello');
      const parts = result.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveLength(32); // 16-byte IV as hex = 32 chars
      expect(parts[1].length).toBeGreaterThan(0);
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', () => {
      const a = service.encrypt('same input');
      const b = service.encrypt('same input');
      expect(a).not.toBe(b);
    });

    it('should produce hex-encoded output', () => {
      const result = service.encrypt('test');
      const [iv, ciphertext] = result.split(':');
      expect(iv).toMatch(/^[0-9a-f]+$/);
      expect(ciphertext).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ── Decrypt ──────────────────────────────────────────────────────────────────

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
  });

  // ── Round-trip integrity ─────────────────────────────────────────────────────

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
      // Both ciphertexts are different (random IV) but both decrypt correctly
      expect(service.decrypt(enc1)).toBe(original);
      expect(service.decrypt(enc2)).toBe(original);
    });
  });
});
