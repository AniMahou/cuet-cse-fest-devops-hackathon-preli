import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Custom error types
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationErrorHandler extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden access') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

// Error response interface
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId?: string;
    timestamp: string;
  };
}

// Setup global error handler
export function setupErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    async (error: any, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id || 'unknown';
      const timestamp = new Date().toISOString();

      // Log error
      if (error.statusCode && error.statusCode < 500) {
        // Client errors
        app.log.warn({
          type: 'client_error',
          error: {
            code: error.code || 'UNKNOWN_ERROR',
            message: error.message,
            statusCode: error.statusCode || 400,
          },
          requestId,
          method: request.method,
          url: request.url,
          ip: request.ip,
        });
      } else {
        // Server errors
        app.log.error({
          type: 'server_error',
          error: {
            code: error.code || 'INTERNAL_SERVER_ERROR',
            message: error.message,
            stack: error.stack,
          },
          requestId,
          method: request.method,
          url: request.url,
          ip: request.ip,
        });
      }

      // Handle AppError instances
      if (error instanceof AppError) {
        const errorResponse: ErrorResponse = {
          error: {
            code: error.code || 'APP_ERROR',
            message: error.message,
            statusCode: error.statusCode,
            requestId,
            timestamp,
          },
        };

        return reply.status(error.statusCode).send(errorResponse);
      }

      // Handle Fastify validation errors
      if (error.statusCode === 400 && error.validation) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            statusCode: 400,
            requestId,
            timestamp,
          },
        };

        return reply.status(400).send(errorResponse);
      }

      // Handle JWT errors
      if (error.name === 'UnauthorizedError' || error.message?.includes('jwt')) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing authentication token',
            statusCode: 401,
            requestId,
            timestamp,
          },
        };

        return reply.status(401).send(errorResponse);
      }

      // Handle MongoDB errors
      if (error.name === 'MongoServerError') {
        let statusCode = 500;
        let code = 'DATABASE_ERROR';
        let message = 'Database operation failed';

        // Handle duplicate key error
        if (error.code === 11000) {
          statusCode = 409;
          code = 'DUPLICATE_KEY';
          message = 'Resource already exists';
        }

        // Handle validation error
        if (error.name === 'ValidationError') {
          statusCode = 400;
          code = 'VALIDATION_ERROR';
          message = 'Invalid data provided';
        }

        const errorResponse: ErrorResponse = {
          error: {
            code,
            message,
            statusCode,
            requestId,
            timestamp,
          },
        };

        return reply.status(statusCode).send(errorResponse);
      }

      // Default server error response
      const statusCode = error.statusCode || 500;
      const errorResponse: ErrorResponse = {
        error: {
          code: error.code || 'INTERNAL_SERVER_ERROR',
          message:
            process.env.NODE_ENV === 'production'
              ? 'Internal server error'
              : error.message || 'An unexpected error occurred',
          statusCode,
          requestId,
          timestamp,
        },
      };

      return reply.status(statusCode).send(errorResponse);
    }
  );
}