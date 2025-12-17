import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    this.logger.debug(`Auth attempt for ${request.method} ${request.url}`);

    if (!authHeader) {
      this.logger.warn(
        `No authorization header for ${request.method} ${request.url}`,
      );
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (err || !user) {
      this.logger.error(
        `Authentication failed for ${request.method} ${request.url}`,
        {
          error: err?.message || 'No error message',
          info: info?.message || info || 'No additional info',
          hasUser: !!user,
          headers: {
            hasAuth: !!request.headers.authorization,
            authType: request.headers.authorization?.split(' ')[0],
          },
        },
      );

      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      }

      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token');
      }

      if (info?.name === 'NotBeforeError') {
        throw new UnauthorizedException('Token not active yet');
      }

      if (!request.headers.authorization) {
        throw new UnauthorizedException('No authorization token provided');
      }

      throw (
        err ||
        new UnauthorizedException(info?.message || 'Authentication failed')
      );
    }

    request.user = user;
    return user;
  }
}
