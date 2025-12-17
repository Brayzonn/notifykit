import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken: string;

  @ApiProperty({
    example: {
      id: '123',
      email: 'john@example.com',
      name: 'John Doe',
      role: 'user',
    },
    description: 'User information',
  })
  user: {
    id: string;
    email: string;
    name?: string;
    username: string;
    role: string;
  };
}
