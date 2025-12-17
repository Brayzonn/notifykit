import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class HashService {
  /**
   * Hash a plain text password
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  /**
   * Verify a plain text password against a hash
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if hash needs rehashing
   */
  async needsRehash(hash: string): Promise<boolean> {
    return argon2.needsRehash(hash, {
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }
}
