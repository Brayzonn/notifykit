import { IsNotEmpty, IsString } from 'class-validator';

export class RequestDomainDto {
  @IsString()
  @IsNotEmpty()
  domain: string;
}
