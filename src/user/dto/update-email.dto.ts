import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateEmailDto {
  @IsNotEmpty()
  @IsEmail()
  newEmail: string;

  @IsOptional()
  @IsString()
  password?: string;
}
