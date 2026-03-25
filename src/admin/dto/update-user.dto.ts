import { IsOptional, IsEnum, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'User name' })
  @IsOptional()
  @IsString()
  @Matches(/^[\p{L}\p{N}\p{P}\p{Z}]+$/u, { message: 'name must not contain emojis or special symbols' })
  name?: string;

  @ApiPropertyOptional({
    description: 'User role',
    enum: UserRole,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
