import { Controller, Post, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  CurrentCustomer,
  AuthenticatedCustomer,
} from '../auth/decorators/current-customer.decorator';
import { CustomersService } from './customers.service';
import { Public } from '@/auth/decorators/public.decorator';
import { RequestDomainDto } from '@/customers/dto/customer.dto';
import { QuotaGuard } from '@/auth/guards/api-quota.guard';
import { CustomerRateLimitGuard } from '@/auth/guards/customer-rate-limit.guard';

@Public()
@Controller('customers')
@UseGuards(ApiKeyGuard, CustomerRateLimitGuard, QuotaGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('domain/request')
  async requestDomainVerification(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: RequestDomainDto,
  ) {
    return this.customersService.requestDomainVerification(
      customer.id,
      dto.domain,
    );
  }

  @Post('domain/verify')
  async checkDomainVerification(
    @CurrentCustomer() customer: AuthenticatedCustomer,
  ) {
    return this.customersService.checkDomainVerification(customer.id);
  }

  @Get('domain/status')
  async getDomainStatus(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customersService.getDomainStatus(customer.id);
  }

  @Delete('domain')
  async removeDomain(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customersService.removeDomain(customer.id);
  }
}
