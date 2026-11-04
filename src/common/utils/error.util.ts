export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
};

const hasResponse = (
  error: unknown,
): error is { response: { status?: unknown; data?: unknown } } =>
  typeof error === 'object' &&
  error !== null &&
  'response' in error &&
  typeof (error as { response: unknown }).response === 'object' &&
  (error as { response: unknown }).response !== null;

const hasRequest = (error: unknown): error is { request: unknown } =>
  typeof error === 'object' && error !== null && 'request' in error;

const getErrorCode = (error: unknown): string | undefined => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
};

export const getAxiosErrorData = <T = unknown>(
  error: unknown,
): T | undefined => {
  if (hasResponse(error)) {
    return error.response.data as T | undefined;
  }
  return undefined;
};

export const getAxiosErrorStatus = (error: unknown): number | undefined => {
  if (hasResponse(error) && typeof error.response.status === 'number') {
    return error.response.status;
  }
  return undefined;
};

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export const isTransientError = (error: unknown): boolean => {
  const status = getAxiosErrorStatus(error);
  if (status !== undefined) {
    return TRANSIENT_STATUS_CODES.has(status);
  }

  const code = getErrorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  if (hasRequest(error) && !hasResponse(error)) {
    return true;
  }

  return false;
};
