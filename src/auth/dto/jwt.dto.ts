import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class JwtPayload {
  @ApiProperty({
    description: 'User ID (subject)',
    example: 'clx1234567890abcdefgh',
  })
  sub!: string;

  @ApiProperty({
    enum: UserRole,
    description: 'User role',
    example: UserRole.USER,
  })
  role!: UserRole;

  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({
    required: false,
    description: 'Issued at timestamp',
    example: 1699123456,
  })
  iat?: number;

  @ApiProperty({
    required: false,
    description: 'Expiration timestamp',
    example: 1699209856,
  })
  exp?: number;
}
