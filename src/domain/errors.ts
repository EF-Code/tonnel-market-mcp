export const ERROR_CODES = [
  "INVALID_ARGUMENT",
  "UNSUPPORTED_EVENT_VERSION",
  "UPSTREAM_UNAVAILABLE",
  "REPLAY_RATE_LIMITED",
  "CURSOR_EXPIRED",
  "COVERAGE_INCOMPLETE",
  "INSUFFICIENT_HISTORY",
  "INSUFFICIENT_COMPARABLES",
  "MIXED_ASSETS",
  "RESULT_LIMIT_EXCEEDED",
  "DATABASE_UNAVAILABLE",
  "MIGRATION_REQUIRED",
  "ALERT_NOT_FOUND",
  "NOTIFIER_UNAVAILABLE",
  "PROTOCOL_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toSafeError(
  error: unknown,
  correlationId: string,
): {
  code: ErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      correlationId,
      retryable: error.retryable,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An internal error occurred while processing the request.",
    correlationId,
    retryable: false,
  };
}
