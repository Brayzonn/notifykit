import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegenerateApiKeyDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to confirm API key regeneration'
  })
  @IsNotEmpty()
  @IsString()
  confirmEmail: string;
}
