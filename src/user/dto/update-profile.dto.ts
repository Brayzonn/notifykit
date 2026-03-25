import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const NO_EMOJI_REGEX = /^[\p{L}\p{N}\p{P}\p{Z}]+$/u;
const NO_EMOJI_MESSAGE = 'must not contain emojis or special symbols';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(NO_EMOJI_REGEX, { message: `name ${NO_EMOJI_MESSAGE}` })
  name?: string;

  @ApiPropertyOptional({ example: 'Acme Corp', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(NO_EMOJI_REGEX, { message: `company ${NO_EMOJI_MESSAGE}` })
  company?: string;
}
