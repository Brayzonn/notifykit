import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmailProviderType } from '@prisma/client';

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

  @ApiPropertyOptional({
    enum: EmailProviderType,
    description:
      'Force this email through a specific configured provider (paid plans only). If unset, the customer\'s priority order with full failover applies.',
  })
  @IsEnum(EmailProviderType)
  @IsOptional()
  provider?: EmailProviderType;

  @ApiPropertyOptional({
    enum: EmailProviderType,
    description:
      'Fallback provider to try if `provider` fails. Ignored unless `provider` is set. Other configured providers are not tried.',
  })
  @IsEnum(EmailProviderType)
  @IsOptional()
  fallback?: EmailProviderType;
}
