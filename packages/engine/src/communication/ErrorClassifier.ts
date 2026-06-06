import { FailoverReason } from '@agentx/shared';
import type { ClassifiedError } from '@agentx/shared';

export class ErrorClassifier {
  classify(error: unknown): ClassifiedError {
    const message = this.extractMessage(error);
    const status = this.extractStatus(error);

    if (status !== undefined) {
      return this.classifyByStatus(status, message);
    }

    return this.classifyByMessage(message);
  }

  private classifyByStatus(
    status: number,
    message: string,
  ): ClassifiedError {
    switch (status) {
      case 401:
        return {
          reason: FailoverReason.AUTH,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          shouldFallback: false,
          providerStatus: status,
          providerMessage: message,
        };

      case 402:
        return {
          reason: FailoverReason.BILLING,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 403:
        return {
          reason: FailoverReason.POLICY_BLOCK,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 404:
        return {
          reason: FailoverReason.MODEL_NOT_FOUND,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 408:
        return {
          reason: FailoverReason.TIMEOUT,
          retryable: true,
          shouldCompress: true,
          shouldRotateCredential: false,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 413:
        return {
          reason: FailoverReason.FORMAT,
          retryable: false,
          shouldCompress: true,
          shouldRotateCredential: false,
          shouldFallback: false,
          providerStatus: status,
          providerMessage: message,
        };

      case 415:
        return {
          reason: FailoverReason.FORMAT,
          retryable: false,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: false,
          providerStatus: status,
          providerMessage: message,
        };

      case 422:
        return {
          reason: FailoverReason.FORMAT,
          retryable: false,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: false,
          providerStatus: status,
          providerMessage: message,
        };

      case 429:
        return {
          reason: FailoverReason.RATE_LIMIT,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 500:
        return {
          reason: FailoverReason.SERVER_ERROR,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 502:
      case 503:
        return {
          reason: FailoverReason.OVERLOADED,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      case 504:
        return {
          reason: FailoverReason.TIMEOUT,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: false,
          shouldFallback: true,
          providerStatus: status,
          providerMessage: message,
        };

      default:
        if (status >= 500) {
          return {
            reason: FailoverReason.SERVER_ERROR,
            retryable: true,
            shouldCompress: false,
            shouldRotateCredential: false,
            shouldFallback: true,
            providerStatus: status,
            providerMessage: message,
          };
        }
        break;
    }

    return this.defaultError(message);
  }

  private classifyByMessage(message: string): ClassifiedError {
    const lower = message.toLowerCase();

    if (
      lower.includes('context length') ||
      lower.includes('context_length_exceeded') ||
      lower.includes('maximum context length') ||
      lower.includes('token limit') ||
      lower.includes('too many tokens') ||
      lower.includes('reduce the length')
    ) {
      return {
        reason: FailoverReason.CONTEXT_OVERFLOW,
        retryable: true,
        shouldCompress: true,
        shouldRotateCredential: false,
        shouldFallback: false,
        providerMessage: message,
      };
    }

    if (
      lower.includes('rate limit') ||
      lower.includes('rate_limit') ||
      lower.includes('too many requests') ||
      lower.includes('quota exceeded')
    ) {
      return {
        reason: FailoverReason.RATE_LIMIT,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: true,
        shouldFallback: true,
        providerMessage: message,
      };
    }

    if (
      lower.includes('invalid api key') ||
      lower.includes('incorrect api key') ||
      lower.includes('unauthorized') ||
      lower.includes('authentication')
    ) {
      return {
        reason: FailoverReason.AUTH,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: true,
        shouldFallback: false,
        providerMessage: message,
      };
    }

    if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('etimedout') ||
      lower.includes('aborted')
    ) {
      return {
        reason: FailoverReason.TIMEOUT,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: true,
        providerMessage: message,
      };
    }

    if (
      lower.includes('content filter') ||
      lower.includes('content_policy_violation') ||
      lower.includes('safety') ||
      lower.includes('moderation')
    ) {
      return {
        reason: FailoverReason.POLICY_BLOCK,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
        providerMessage: message,
      };
    }

    if (
      lower.includes('model not found') ||
      lower.includes('model_not_found') ||
      lower.includes('does not exist')
    ) {
      return {
        reason: FailoverReason.MODEL_NOT_FOUND,
        retryable: false,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: true,
        providerMessage: message,
      };
    }

    if (
      lower.includes('invalid json') ||
      lower.includes('malformed') ||
      lower.includes('parse error') ||
      lower.includes('unexpected token')
    ) {
      return {
        reason: FailoverReason.FORMAT,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
        providerMessage: message,
      };
    }

    if (
      lower.includes('tool_repair') ||
      lower.includes('invalid tool') ||
      lower.includes('unknown function')
    ) {
      return {
        reason: FailoverReason.TOOL_REPAIR_FAILED,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        shouldFallback: false,
        providerMessage: message,
      };
    }

    return this.defaultError(message);
  }

  private extractMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      return String(
        obj.message ??
          obj.error ??
          obj.statusText ??
          obj.msg ??
          JSON.stringify(error),
      );
    }
    return String(error);
  }

  private extractStatus(error: unknown): number | undefined {
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      const status =
        obj.status ??
        obj.statusCode ??
        obj.code;
      if (typeof status === 'number') return status;
      if (typeof status === 'string') {
        const parsed = parseInt(status, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return undefined;
  }

  private defaultError(message: string): ClassifiedError {
    return {
      reason: FailoverReason.UNKNOWN,
      retryable: true,
      shouldCompress: false,
      shouldRotateCredential: false,
      shouldFallback: true,
      providerMessage: message,
    };
  }
}
