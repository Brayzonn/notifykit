import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * ============================================================================
 *   TODO (BLOCKING): MIGRATE EXISTING ENCRYPTED DATA BEFORE / WITH THIS DEPLOY
 * ============================================================================
 *
 * This service was switched from AES-256-CBC -> AES-256-GCM.
 *
 * OLD format (CBC): "iv:ciphertext"            (2 parts)
 * NEW format (GCM): "iv:ciphertext:authTag"    (3 parts)
 *
 * decrypt() below ONLY understands the new 3-part GCM format.
 * Any row still encrypted under the old CBC format WILL THROW on decrypt.
 *
 * Affected columns:
 *   - CustomerEmailProvider.apiKey
 *   - CustomerEmailProvider.accountApiKey
 *
 * Impact if not migrated before deploy:
 *   - Existing customers' email sends fail (EmailWorkerProcessor decrypt)
 *   - Dashboard "last four" key preview breaks
 *   - autoRegisterDomainForNewProvider breaks
 *
 * DO NOT deploy this file until:
 *   [ ] Migration script has run (decrypt old CBC -> re-encrypt new GCM)
 *       for every row in the affected columns above
 *   [ ] Verified no rows remain in old "iv:ciphertext" (2-part) format
 *   [ ] Legacy CBC decrypt helper removed once migration is confirmed done
 *
 * If this is still pre-launch with no real customer data: skip migration,
 * just wipe the affected table(s) instead.
 * ============================================================================
 */
@Injectable()
export class EncryptionService {
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('ENCRYPTION_KEY');
    if (!key || key.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return (
      iv.toString('hex') +
      ':' +
      encrypted.toString('hex') +
      ':' +
      authTag.toString('hex')
    );
  }

  decrypt(text: string): string {
    const [ivHex, encryptedHex, authTagHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
