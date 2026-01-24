import { IsEmail, IsNotEmpty } from 'class-validator';

export class DeleteAccountDto {
  @IsNotEmpty()
  @IsEmail()
  confirmEmail: string;
}
