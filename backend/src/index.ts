import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyRedis from '@fastify/redis';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Static, Type } from '@sinclair/typebox';

// Import modules
import { connectDB, disconnectDB } from './config/db';
import { envConfig, validateEnv } from './config/envConfig';
import { setupErrorHandler } from './config/errorHandler';
import { productsRoutes } from './routes/products';
import { healthRoutes } from './routes/health';
import { metricsPlugin } from './plugins/metrics';
import { cachePlugin } from './plugins/cache';

// App options interface
interface AppOptions extends FastifyServerOptions {
  logger: boolean;
}

// Health check response schema
const HealthResponseSchema = Type.Object({
  status: Type.String(),
  timestamp: Type.String(),
  uptime: Type.Number(),
  database: Type.String(),
  redis: Type.String(),
  memory: Type.Object({
    rss: Type.Number(),
    heapTotal: Type.Number(),
    heapUsed: Type.Number(),
    external: Type.Number(),
  }),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;

// Build Fastify app
export async function buildApp(options: AppOptions = { logger: true }) {
  const app = Fastify({
    ...options,
    logger: options.logger ? {
      level: envConfig.logLevel,
      transport: envConfig.nodeEnv === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    } : false,
    pluginTimeout: 30000,
    bodyLimit: 1048576 * 10, // 10MB
    caseSensitive: false,
    requestIdHeader: 'x-request-id',
    trustProxy: true, // For X-Forwarded-* headers
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Validate environment variables
  validateEnv();

  // Register plugins
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "validator.swagger.io"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  });

  await app.register(fastifyCors, {
    origin: envConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  await app.register(fastifyRateLimit, {
    max: envConfig.rateLimitMax,
    timeWindow: '1 minute',
    redis: envConfig.redisUrl ? {
      host: new URL(envConfig.redisUrl).hostname,
      port: parseInt(new URL(envConfig.redisUrl).port),
    } : undefined,
    skipOnError: true,
    enableDraftSpec: true,
  });

  if (envConfig.redisUrl) {
    await app.register(fastifyRedis, {
      url: envConfig.redisUrl,
      closeClient: true,
    });
    await app.register(cachePlugin);
  }

  await app.register(fastifyJwt, {
    secret: envConfig.jwtSecret,
    sign: {
      expiresIn: '1h',
    },
    verify: {
      maxAge: '1h',
    },
  });

  // Swagger documentation (development only)
  if (envConfig.nodeEnv === 'development') {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Product API',
          description: 'Product management API documentation',
          version: '1.0.0',
        },
        servers: [
          {
            url: `http://localhost:${envConfig.port}`,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        tags: [
          { name: 'products', description: 'Product related end-points' },
          { name: 'health', description: 'Health check end-points' },
        ],
      },
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }

  // Custom plugins
  await app.register(metricsPlugin);
  setupErrorHandler(app);

  // Database connection hook
  app.addHook('onReady', async () => {
    try {
      await connectDB();
      app.log.info('Database connected successfully');
    } catch (error) {
      app.log.error('Database connection failed:', error);
      process.exit(1);
    }
  });

  // Request ID hook
  app.addHook('onRequest', async (request, reply) => {
    const requestId = request.headers['x-request-id'] ||
      `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    request.id = requestId;
    reply.header('x-request-id', requestId);
  });

  // Request logging hook
  app.addHook('onResponse', async (request, reply) => {
    const { method, url } = request;
    const { statusCode } = reply;
    const responseTime = reply.getResponseTime();

    app.log.info({
      type: 'request',
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      requestId: request.id,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  });

  // Register routes
  await app.register(productsRoutes, { prefix: '/api/products' });
  await app.register(healthRoutes, { prefix: '/api/health' });

  // Graceful shutdown
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, starting graceful shutdown`);

      // Close database connection
      await disconnectDB();

      // Close Fastify app
      await app.close();

      app.log.info('Graceful shutdown complete');
      process.exit(0);
    });
  });

  return app;
}

// Start server if this file is executed directly
if (require.main === module) {
  (async () => {
    try {
      const app = await buildApp();

      await app.listen({
        port: envConfig.port,
        host: envConfig.host,
      });

      app.log.info(`Server listening on ${envConfig.host}:${envConfig.port}`);
      app.log.info(`Environment: ${envConfig.nodeEnv}`);
      app.log.info(`API Documentation: http://${envConfig.host}:${envConfig.port}/docs`);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();
}