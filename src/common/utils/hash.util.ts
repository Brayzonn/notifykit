import * as crypto from 'crypto';

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
