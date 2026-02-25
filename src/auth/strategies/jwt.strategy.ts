import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { JwtPayload } from '@/auth/dto/auth.dto';
import { CustomerPlan } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'fake-secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const cacheKey = `user:${payload.sub}`;

    return this.redis.remember(cacheKey, 300, async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          customer: true,
        },
      });

      if (!user) throw new UnauthorizedException();
      if (user.deletedAt)
        throw new UnauthorizedException('Account has been deleted');

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.customer?.plan || CustomerPlan.FREE,
      };
    });
  }
}
