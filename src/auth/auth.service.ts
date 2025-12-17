import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UsersRepository } from '@/users/users.repository';
import { HashService } from '@/common/services/hash.service';
import { User, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '@/auth/dto/jwt.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private usersRepository: UsersRepository,
    private jwtService: JwtService,
    private hashService: HashService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const { email, password, username } = registerDto;

    const existingUser = await this.usersRepository.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await this.hashService.hash(password);

    const user = await this.usersRepository.create({
      email,
      password: hashedPassword,
      username,
      role: UserRole.USER,
    });

    const accessToken = this.createAccessToken(user);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, password } = loginDto;

    const user = await this.usersRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await argon2.verify(user.password, password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.createAccessToken(user);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

  private createAccessToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      email: user.email,
    };

    return this.jwtService.sign(payload, {
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '15m',
    });
  }
}
