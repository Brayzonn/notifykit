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

// Duck-types `{ response: { data } }` so this works on real AxiosError instances
// and on hand-rolled shapes some upstream code throws.
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
