import { Injectable, ForbiddenException } from '@nestjs/common';
import { CustomerPlan } from '@prisma/client';

export type GateableCustomer = {
  plan: CustomerPlan;
  sendgridApiKey?: string | null;
  sendingDomain?: string | null;
  domainVerified?: boolean;
};

@Injectable()
export class FeatureGateService {
  /**
   * Paid plans must have a SendGrid key to send emails
   */
  assertCanSendEmail(customer: GateableCustomer) {
    if (customer.plan !== CustomerPlan.FREE && !customer.sendgridApiKey) {
      throw new ForbiddenException(
        'Please add your SendGrid API key in Settings before sending emails.',
      );
    }
  }

  /**
   * Custom sending domains are paid-plan only
   */
  assertCanUseCustomDomain(customer: GateableCustomer) {
    if (customer.plan === CustomerPlan.FREE) {
      throw new ForbiddenException(
        'Custom sending domains are only available on paid plans. Please upgrade to continue.',
      );
    }
  }

  /**
   * Priority queue is paid-plan only
   */
  assertCanUsePriorityQueue(customer: GateableCustomer) {
    if (customer.plan === CustomerPlan.FREE) {
      throw new ForbiddenException(
        'Priority queue is only available on paid plans. Please upgrade to continue.',
      );
    }
  }

  assertCanSendEmailFromDomain(customer: GateableCustomer) {
    if (customer.plan === CustomerPlan.FREE) return;

    if (!customer.sendingDomain) {
      throw new ForbiddenException(
        'Paid plans must use a verified sending domain. Please add and verify your domain in Settings.',
      );
    }

    if (!customer.domainVerified) {
      throw new ForbiddenException(
        'Your sending domain is pending verification. Please complete domain verification in Settings.',
      );
    }
  }

  /**
   * Generic feature gate using feature matrix
   */
  assertFeature(feature: Feature, customerPlan: CustomerPlan) {
    const allowedPlans = FEATURE_MATRIX[feature];

    if (!allowedPlans?.includes(customerPlan)) {
      throw new ForbiddenException(
        `This feature is not available on your current plan.`,
      );
    }
  }
}

export const FEATURE_MATRIX: Record<string, CustomerPlan[]> = {
  custom_domain: [CustomerPlan.INDIE, CustomerPlan.STARTUP],
  priority_queue: [CustomerPlan.INDIE, CustomerPlan.STARTUP],
  webhook: [CustomerPlan.FREE, CustomerPlan.INDIE, CustomerPlan.STARTUP],
  email: [CustomerPlan.FREE, CustomerPlan.INDIE, CustomerPlan.STARTUP],
};

export type Feature = keyof typeof FEATURE_MATRIX;
