import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { UserAuthMethod, UserRole } from '../../../node_modules/.prisma/client';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsBoolean()
  emailValidated?: boolean;

  @IsOptional()
  @IsEnum(UserAuthMethod)
  userAuthMethod?: UserAuthMethod;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
