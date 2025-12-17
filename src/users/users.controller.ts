import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { Public } from '@/auth/decorators/public.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { Role } from '@/common/enums/role.enum';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '',
    description: '',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '',
    type: '',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '',
    schema: {
      example: null,
    },
  })
  @ApiUnauthorizedResponse({ description: '' })
  @ApiForbiddenResponse({
    description: '',
  })
  @ApiInternalServerErrorResponse({
    description: '',
  })
  async findAll(@Query('page') page?: number, @Query('limit') limit?: number) {}
}
