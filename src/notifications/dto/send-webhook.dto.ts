import {
  IsUrl,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsObject,
  IsString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10kb

function MaxPayloadSize(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxPayloadSize',
      target: object.constructor,
      propertyName,
      options: { message: `payload must not exceed ${MAX_PAYLOAD_BYTES / 1024}kb`, ...options },
      validator: {
        validate(value: any) {
          try {
            return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_PAYLOAD_BYTES;
          } catch {
            return false;
          }
        },
      },
    });
  };
}

export class SendWebhookDto {
  @ApiProperty({
    example: 'https://api.example.com/webhook',
    description: 'Webhook destination URL',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({
    example: 'POST',
    description: 'HTTP method (default: POST)',
    default: 'POST',
  })
  @IsString()
  @IsOptional()
  method?: string;

  @ApiPropertyOptional({
    example: { 'Content-Type': 'application/json', 'X-Custom-Header': 'value' },
    description: 'Custom HTTP headers',
  })
  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;

  @ApiProperty({
    example: {
      event: 'user.created',
      data: { id: 123, email: 'user@example.com' },
    },
    description: 'Webhook payload data',
  })
  @MaxPayloadSize()
  @IsObject()
  @IsNotEmpty()
  payload: any;

  @ApiPropertyOptional({
    example: 5,
    enum: [1, 5, 10],
    description: 'Priority level (1=high, 5=normal, 10=low)',
    default: 5,
  })
  @IsIn([1, 5, 10])
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({
    example: 'unique-key-456',
    description: 'Idempotency key to prevent duplicate sends',
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
