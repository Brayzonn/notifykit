import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UseGuards,
  UnauthorizedException,
  Get,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import {
  SignupDto,
  SigninDto,
  VerifyOtpDto,
  ResendOtpDto,
} from '@/auth/dto/auth.dto';
import { AuthService } from '@/auth/auth.service';
import { CookieConfig } from '@/config/cookie.config';
import { ConfigService } from '@nestjs/config';
import { Public } from '@/auth/decorators/public.decorator';
import { AuthGuard } from '@nestjs/passport';
import { GithubProfile } from '@/auth/interfaces/auth.interface';
import { access } from 'fs';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() signupDto: SignupDto) {
    const result = await this.authService.signup(signupDto);
    return result;
  }

  @Public()
  @Get('github')
  @UseGuards(AuthGuard('github'))
  async githubAuth() {}

  @Public()
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';

    try {
      const githubUser = req.user as GithubProfile;

      const { user, tokens } =
        await this.authService.validateGithubUser(githubUser);

      res.cookie(
        'refreshToken',
        tokens.refreshToken,
        CookieConfig.getRefreshTokenOptions(this.configService),
      );

      const payload = {
        accessToken: tokens.accessToken,
        user,
      };

      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
        'base64',
      );

      return res.redirect(
        302,
        `${frontendUrl}/auth/github/callback?token=${encodedPayload}&success=true`,
      );
    } catch (error) {
      let errorMessage = 'Authentication failed';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      return res.redirect(
        302,
        `${frontendUrl}/auth/github/callback?success=false&error=${encodeURIComponent(errorMessage)}`,
      );
    }
  }

  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  async signin(
    @Body() signinDto: SigninDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const {
      user,
      tokens: { accessToken, refreshToken },
    } = await this.authService.signin(signinDto);

    response.cookie(
      'refreshToken',
      refreshToken,
      CookieConfig.getRefreshTokenOptions(this.configService),
    );

    return { user, accessToken };
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const {
      user,
      tokens: { accessToken, refreshToken },
    } = await this.authService.verifyOtp(verifyOtpDto);

    response.cookie(
      'refreshToken',
      refreshToken,
      CookieConfig.getRefreshTokenOptions(this.configService),
    );

    return { user, accessToken };
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() resendOtpDto: ResendOtpDto) {
    const result = await this.authService.resendOtp(resendOtpDto);

    return result;
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieRefreshToken = request.cookies?.refreshToken;
    if (!cookieRefreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const { user, tokens } =
      await this.authService.refreshToken(cookieRefreshToken);

    if (tokens.refreshToken) {
      response.cookie(
        'refreshToken',
        tokens.refreshToken,
        CookieConfig.getRefreshTokenOptions(this.configService),
      );
    }

    return { user, accessToken: tokens.accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refreshToken;
    console.log(`Logout attempt - cookie present: ${!!refreshToken}`);

    if (!refreshToken) {
      console.warn('Logout failed - no refresh token cookie');
      throw new UnauthorizedException('Refresh token not found');
    }

    const result = await this.authService.logout(refreshToken);
    console.log('Logout complete - clearing cookie');

    const cookieOptions = CookieConfig.getRefreshTokenOptions(
      this.configService,
    );

    response.clearCookie('refreshToken', cookieOptions);

    return result;
  }
}
