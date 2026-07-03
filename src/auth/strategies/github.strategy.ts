import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { GithubProfile } from '@/auth/interfaces/auth.interface';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = configService.get<string>('GITHUB_CLIENT_SECRET');
    const callbackURL = configService.get<string>('GITHUB_CALLBACK_URL');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error('GitHub OAuth credentials are not configured');
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['user:email', 'read:user'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GithubProfile {
    const { id, username, emails, displayName, photos } = profile;

    const email = emails?.[0]?.value;

    if (!email) {
      throw new UnauthorizedException(
        'No email found in GitHub profile. Please make your email public on GitHub.',
      );
    }

    return {
      githubId: id,
      email,
      username: username || 'github-user',
      name: displayName || username || 'GitHub User',
      avatar: photos?.[0]?.value,
    };
  }
}
