export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface OtpEmailData {
  email: string;
  otp: string;
  expiresInMinutes: number;
}

export interface WelcomeEmailData {
  email: string;
  name: string;
}

export interface ResetPasswordEmailData {
  email: string;
  resetToken: string;
  resetUrl: string;
}

export interface EmailChangeVerificationData {
  email: string;
  name: string;
  verifyLink: string;
}

export interface EmailChangeConfirmationData {
  email: string;
  name: string;
  newEmail: string;
  confirmLink: string;
  cancelLink: string;
}

export interface EmailChangeCancelledData {
  email: string;
  newEmail: string;
}

export interface EmailChangeSuccessData {
  email: string;
}

export interface PaymentFailedEmailData {
  email: string;
  name: string;
  plan: string;
  amount: number;
  retryDate: Date | null;
}
