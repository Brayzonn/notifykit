import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to confirm account deletion'
  })
  @IsNotEmpty()
  @IsEmail()
  confirmEmail: string;
}
