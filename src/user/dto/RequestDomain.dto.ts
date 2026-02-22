import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestDomainDto {
  @ApiProperty({
    example: 'notifications.example.com',
    description: 'Domain to verify for sending emails'
  })
  @IsString()
  @IsNotEmpty()
  domain: string;
}
