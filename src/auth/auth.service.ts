import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthProvider, User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/platform-email/email.service';
import {
  SignupDto,
  SigninDto,
  VerifyOtpDto,
  ResendOtpDto,
} from '@/auth/dto/auth.dto';
import {
  AuthResponse,
  GithubProfile,
  RefreshTokenResponse,
} from '@/auth/interfaces/auth.interface';
import {
  OTP_EXPIRES_IN_MINUTES,
  OTP_TTL_SECONDS,
} from '@/auth/constants/auth.constants';
import { normalizeEmail, sanitizeUser } from '@/auth/helpers/auth.helpers';
import { SessionService } from '@/auth/services/session.service';
import { OtpService } from '@/auth/services/otp.service';
import { UserProvisioningService } from '@/auth/services/user-provisioning.service';

const RESET_REQUESTED_MESSAGE =
  'If this email exists, a reset code has been sent';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly session: SessionService,
    private readonly otp: OtpService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async validateGithubUser(profile: GithubProfile): Promise<AuthResponse> {
    if (!profile.email) {
      throw new UnauthorizedException(
        'No public email found. Please make your email public on GitHub.',
      );
    }

    profile.email = normalizeEmail(profile.email);

    const { user, isNewUser } =
      await this.provisioning.upsertGithubUser(profile);

    if (user.deletedAt) {
      throw new UnauthorizedException(
        'Account has been deleted. Please contact support.',
      );
    }

    await this.provisioning.ensureCustomer(user);

    if (isNewUser) {
      this.provisioning.sendWelcomeEmail(user);
    }

    return this.buildAuthResponse(user);
  }

  async signup(signupDto: SignupDto): Promise<{ email: string }> {
    const email = normalizeEmail(signupDto.email);

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser && existingUser.emailVerified) {
      throw new ConflictException('Email already registered');
    }

    await this.provisioning.savePendingSignup({
      email,
      password: await argon2.hash(signupDto.password),
      name: signupDto.name,
      company: signupDto.company,
    });

    const otp = await this.otp.issue('signup', email);

    try {
      await this.emailService.sendOtpEmail({
        email,
        otp,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      });
    } catch {
      await this.provisioning.clearPendingSignup(email);
      await this.otp.clear('signup', email);
      throw new BadRequestException('Failed to send verification email');
    }

    this.logger.log(`Signup initiated for ${email}`);

    return { email };
  }

  async signin(signinDto: SigninDto): Promise<AuthResponse> {
    signinDto.email = normalizeEmail(signinDto.email);

    const user = await this.prisma.user.findUnique({
      where: { email: signinDto.email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('Account has been deleted');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email.');
    }

    const isPasswordValid = await argon2.verify(
      user.password,
      signinDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    email = normalizeEmail(email);

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.emailVerified || user.deletedAt) {
      return { message: RESET_REQUESTED_MESSAGE };
    }

    if (user.provider !== AuthProvider.EMAIL) {
      throw new BadRequestException(
        'This account uses social login. Please sign in with social login.',
      );
    }

    const otp = await this.otp.issue('reset-password', email);

    try {
      await this.emailService.sendResetPasswordEmail({
        email,
        otp,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      });
    } catch {
      await this.otp.clear('reset-password', email);
      throw new BadRequestException('Failed to send reset email');
    }

    this.logger.log(`Password reset OTP sent to ${email}`);
    return { message: RESET_REQUESTED_MESSAGE };
  }

  async confirmPasswordReset(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    email = normalizeEmail(email);

    if ((await this.otp.consume('reset-password', email, otp)) !== 'valid') {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await argon2.hash(newPassword) },
    });

    await this.session.revokeAllForUser(user.id);

    this.logger.log(`Password reset successful for ${email}`);
    return { message: 'Password reset successfully' };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<AuthResponse> {
    const email = normalizeEmail(verifyOtpDto.email);

    const otpResult = await this.otp.consume('signup', email, verifyOtpDto.otp);

    if (otpResult === 'locked') {
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please try again in a few minutes.',
      );
    }

    if (otpResult === 'missing') {
      throw new UnauthorizedException('OTP expired. Please sign up again.');
    }

    if (otpResult === 'mismatch') {
      throw new UnauthorizedException('Invalid OTP');
    }

    const pendingSignup = await this.provisioning.getPendingSignup(email);

    if (!pendingSignup) {
      throw new UnauthorizedException(
        'Signup session expired. Please sign up again.',
      );
    }

    const user = await this.provisioning.upsertEmailUser(pendingSignup);
    await this.provisioning.ensureCustomer(user);

    await this.provisioning.clearPendingSignup(email);

    this.provisioning.sendWelcomeEmail(user);

    return this.buildAuthResponse(user);
  }

  async resendOtp(resendOtpDto: ResendOtpDto): Promise<{ expiresIn: number }> {
    const email = normalizeEmail(resendOtpDto.email);

    const pendingSignup = await this.provisioning.getPendingSignup(email);

    if (!pendingSignup) {
      throw new UnauthorizedException(
        'Signup session expired. Please sign up again.',
      );
    }

    await this.otp.reserveResend(email);

    const otp = this.otp.generate();

    try {
      await this.emailService.sendOtpEmail({
        email,
        otp,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      });
    } catch {
      await this.otp.releaseResend(email);
      throw new BadRequestException('Failed to send verification email');
    }

    await this.otp.store('signup', email, otp);
    await this.provisioning.savePendingSignup(pendingSignup);

    this.logger.log(`Resent OTP for ${email}`);

    return { expiresIn: OTP_TTL_SECONDS };
  }

  async refreshToken(token: string): Promise<RefreshTokenResponse> {
    return this.session.refresh(token);
  }

  async logout(token: string): Promise<{ message: string }> {
    if (await this.session.revoke(token)) {
      this.logger.log('User logged out successfully');
    } else {
      this.logger.warn('Refresh token not found during logout');
    }
    return { message: 'Logged out successfully' };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const tokens = await this.session.issueSession(user);
    return { user: sanitizeUser(user), tokens };
  }
}
