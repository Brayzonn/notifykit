import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { User } from '@/common/decorators/user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  async upgradePlan(
    @User() user: AuthenticatedUser,
    @Body() upgradePlanDto: UpgradePlanDto,
  ) {
    return this.billingService.createUpgradeCheckout(
      user.id,
      upgradePlanDto.plan,
    );
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(
    @User() user: AuthenticatedUser,
    @Body() cancelDto: CancelSubscriptionDto,
  ) {
    return this.billingService.cancelSubscription(user.id, cancelDto.reason);
  }

  @Get('subscription')
  async getSubscription(@User() user: AuthenticatedUser) {
    return this.billingService.getSubscriptionDetails(user.id);
  }

  @Get('invoices')
  async getInvoices(@User() user: AuthenticatedUser) {
    return this.billingService.getInvoices(user.id);
  }
}
