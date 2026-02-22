import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEmailDto {
  @ApiProperty({ example: 'newemail@example.com' })
  @IsNotEmpty()
  @IsEmail()
  newEmail: string;

  @ApiPropertyOptional({ example: 'Password123' })
  @IsOptional()
  @IsString()
  password?: string;
}
