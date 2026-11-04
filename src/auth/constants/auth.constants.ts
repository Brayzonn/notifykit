const DAY_MS = 24 * 60 * 60 * 1000;

export const OTP_TTL_SECONDS = 600;
export const OTP_EXPIRES_IN_MINUTES = OTP_TTL_SECONDS / 60;
export const OTP_MAX_RESENDS = 3;
export const OTP_MAX_ATTEMPTS = 5;

export const MAX_ACTIVE_SESSIONS = 5;
export const REFRESH_ROTATION_WINDOW_MS = 3 * DAY_MS;
export const REFRESH_LOCK_TTL_SECONDS = 10;

export const FREE_PLAN_USAGE_PERIOD_MS = 30 * DAY_MS;

export type OtpPurpose = 'signup' | 'reset-password';

const OTP_KEY_PREFIX: Record<OtpPurpose, string> = {
  signup: 'otp',
  'reset-password': 'reset-password',
};

export const AuthRedisKeys = {
  otp: (purpose: OtpPurpose, email: string) =>
    `${OTP_KEY_PREFIX[purpose]}:${email}`,
  otpAttempts: (purpose: OtpPurpose, email: string) =>
    `otp-attempts:${purpose}:${email}`,
  otpResendCount: (email: string) => `otp-resend:${email}`,
  pendingSignup: (email: string) => `signup:${email}`,
  refreshLock: (tokenHashPrefix: string) => `refresh_lock:${tokenHashPrefix}`,
  userCache: (userId: string) => `user:${userId}`,
};
