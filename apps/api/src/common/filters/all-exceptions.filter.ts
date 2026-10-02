import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

// Normalizes every error response to { statusCode, error, message } with message always a string array.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException ? exception.getResponse() : undefined;
    const errorName = ERROR_NAMES[statusCode] ?? 'Error';

    if (!isHttpException) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      const fields = error as Error & {
        code?: string;
        constraint?: string;
        table?: string;
        column?: string;
        query?: string;
        driverError?: {
          code?: string;
          constraint?: string;
          table?: string;
          column?: string;
        };
      };
      const driverError = fields.driverError;
      const logRecord = {
        exception: error.constructor.name,
        message: error.message,
        stack: error.stack,
        code: fields.code ?? driverError?.code,
        constraint: fields.constraint ?? driverError?.constraint,
        table: fields.table ?? driverError?.table,
        column: fields.column ?? driverError?.column,
        sql: fields.query,
      };
      this.logger.error(JSON.stringify(logRecord));
    }

    if (typeof body === 'string') {
      response.status(statusCode).json({ statusCode, error: errorName, message: [body] });
      return;
    }

    if (body && typeof body === 'object') {
      const { message: rawMessage, error: rawError, statusCode: _ignored, ...rest } = body as Record<
        string,
        unknown
      >;
      const message = Array.isArray(rawMessage)
        ? rawMessage.map((item) => String(item))
        : rawMessage != null
          ? [String(rawMessage)]
          : [errorName];
      const error = typeof rawError === 'string' ? rawError : errorName;
      response.status(statusCode).json({ statusCode, error, message, ...rest });
      return;
    }

    response
      .status(statusCode)
      .json({ statusCode, error: errorName, message: ['Internal server error'] });
  }
}
