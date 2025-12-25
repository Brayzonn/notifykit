import * as crypto from 'crypto';

export class ApiKeyUtils {
  /**
   * Generate a new API key with format: ntfy_xxxxx
   */
  static generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32);
    const randomString = randomBytes.toString('base64url');
    return `ntfy_${randomString}`;
  }

  /**
   * Hash an API key using SHA256
   */
  static hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Validate API key format
   */
  static isValidFormat(apiKey: string): boolean {
    return /^ntfy_[a-zA-Z0-9_-]{32,}$/.test(apiKey);
  }

  /**
   * Generate API key with hash (for customer creation)
   */
  static generateApiKeyWithHash(): {
    apiKey: string;
    apiKeyHash: string;
  } {
    const apiKey = this.generateApiKey();
    const apiKeyHash = this.hashApiKey(apiKey);

    return { apiKey, apiKeyHash };
  }
}
