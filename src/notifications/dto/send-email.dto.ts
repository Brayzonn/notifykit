import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendEmailDto {
  @ApiProperty({
    example: 'recipient@example.com',
    description: 'Recipient email address'
  })
  @IsEmail()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    example: 'Welcome to NotifyKit',
    description: 'Email subject line'
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: 'Hello! Welcome to our platform.',
    description: 'Email body (HTML or plain text)'
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    example: 'noreply@yourdomain.com',
    description: 'Sender email address (requires verified domain)'
  })
  @IsEmail()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    example: 5,
    enum: [1, 5, 10],
    description: 'Priority level (1=high, 5=normal, 10=low)',
    default: 5
  })
  @IsIn([1, 5, 10])
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({
    example: 'unique-key-123',
    description: 'Idempotency key to prevent duplicate sends'
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
