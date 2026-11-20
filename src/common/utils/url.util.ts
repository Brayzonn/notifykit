const TOKEN_PATH_PATTERN = /\/email\/(verify-new|confirm-old|cancel)\/[^/?#]+/g;

export const redactUrl = (url: string): string =>
  url.replace(TOKEN_PATH_PATTERN, '/email/$1/[redacted]');
