export const APP_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "PROVIDER_TRUNCATED",
  "TASK_CANCELLED",
  "PARSE_FAILED",
  "AUDIT_WRITE_FAILED",
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function appErrorCode(error: unknown): AppErrorCode | null {
  return isAppError(error) ? error.code : null;
}
