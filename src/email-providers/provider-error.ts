import {
  getAxiosErrorData,
  getAxiosErrorStatus,
} from '@/common/utils/error.util';

interface ProviderErrorDetails {
  status?: number;
  data?: unknown;
  code?: string;
  noResponse?: boolean;
}

export class ProviderError extends Error {
  readonly response?: { status: number; data?: unknown };
  readonly request?: true;
  readonly code?: string;

  constructor(message: string, details: ProviderErrorDetails = {}) {
    super(message);
    this.name = 'ProviderError';
    if (details.status !== undefined) {
      this.response = { status: details.status, data: details.data };
    }
    if (details.code) {
      this.code = details.code;
    }
    if (details.noResponse && details.status === undefined) {
      this.request = true;
    }
  }

  static fromHttpError(message: string, error: unknown): ProviderError {
    const status = getAxiosErrorStatus(error);
    const code =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    const requestSent =
      typeof error === 'object' && error !== null && 'request' in error;

    return new ProviderError(message, {
      status,
      data: getAxiosErrorData(error),
      code,
      noResponse: requestSent,
    });
  }
}
