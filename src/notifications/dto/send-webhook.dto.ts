import {
  IsUrl,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsObject,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendWebhookDto {
  @ApiProperty({
    example: 'https://api.example.com/webhook',
    description: 'Webhook destination URL'
  })
  @IsUrl()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({
    example: 'POST',
    description: 'HTTP method (default: POST)',
    default: 'POST'
  })
  @IsString()
  @IsOptional()
  method?: string;

  @ApiPropertyOptional({
    example: { 'Content-Type': 'application/json', 'X-Custom-Header': 'value' },
    description: 'Custom HTTP headers'
  })
  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;

  @ApiProperty({
    example: { event: 'user.created', data: { id: 123, email: 'user@example.com' } },
    description: 'Webhook payload data'
  })
  @IsObject()
  @IsNotEmpty()
  payload: any;

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
    example: 'unique-key-456',
    description: 'Idempotency key to prevent duplicate sends'
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
