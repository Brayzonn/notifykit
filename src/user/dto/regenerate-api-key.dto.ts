import { IsNotEmpty, IsString } from 'class-validator';

export class RegenerateApiKeyDto {
  @IsNotEmpty()
  @IsString()
  confirmEmail: string;
}
