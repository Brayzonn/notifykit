import { IsNotEmpty, IsString } from 'class-validator';

export class CancelEmailChangeDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}
