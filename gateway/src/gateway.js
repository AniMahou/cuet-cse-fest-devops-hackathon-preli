import Fastify from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyProxy from "@fastify/http-proxy";
import fastifyMetrics from "fastify-metrics";

// Environment configuration
const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.GATEWAY_PORT || "5921"),
  backendUrl: process.env.BACKEND_URL || "http://backend:3000",
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || "*",
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  logLevel: process.env.LOG_LEVEL || "info",
};

// Circuit breaker configuration
const circuitBreaker = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenTimeout: 10000,
  timeout: 10000,
};

// Build Fastify gateway
export async function buildGateway() {
  const gateway = Fastify({
    logger: {
      level: env.logLevel,
      transport:
        env.nodeEnv === "development" ? { target: "pino-pretty" } : undefined,
    },
    disableRequestLogging: false,
    requestIdHeader: "x-request-id",
    trustProxy: true,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100,
  });

  // Register security plugins
  await gateway.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  await gateway.register(fastifyCors, {
    origin: env.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID"],
  });

  await gateway.register(fastifyRateLimit, {
    max: env.rateLimitMax,
    timeWindow: "1 minute",
    skipOnError: true,
    keyGenerator: (request) => request.ip,
    enableDraftSpec: true,
  });

  // Metrics endpoint
  await gateway.register(fastifyMetrics, {
    endpoint: "/metrics",
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: true,
    },
  });

  // Request ID middleware
  gateway.addHook("onRequest", async (request, reply) => {
    const requestId =
      request.headers["x-request-id"] ||
      `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    request.id = requestId;
    reply.header("x-request-id", requestId);
  });

  // Logging middleware
  gateway.addHook("onResponse", (request, reply, done) => {
    const { method, url } = request;
    const { statusCode } = reply;
    const responseTime = reply.getResponseTime();

    gateway.log.info({
      type: "gateway_request",
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      requestId: request.id,
      userAgent: request.headers["user-agent"],
      ip: request.ip,
      upstream: env.backendUrl,
    });

    done();
  });

  // Health check endpoint
  gateway.route({
    method: "GET",
    url: "/health",
    handler: async (_, reply) => {
      return reply.send({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "gateway",
        upstream: env.backendUrl,
      });
    },
  });

  // Proxy configuration with circuit breaker
  await gateway.register(fastifyProxy, {
    upstream: env.backendUrl,
    prefix: "/api",
    rewritePrefix: "/api",
    http2: false,
    undici: true, // Use undici for better HTTP/1.1 performance
    replyOptions: {
      rewriteRequestHeaders: (originalReq, headers) => {
        let host;
        try {
          host = new URL(env.backendUrl).host;
        } catch (err) {
          host = "localhost:3000";
        }

        return {
          ...headers,
          "x-forwarded-for": originalReq.ip,
          "x-forwarded-host": originalReq.hostname,
          "x-forwarded-proto": originalReq.protocol,
          "x-request-id": originalReq.id,
          host: host,
        };
      },
    },
    preHandler: async (request, reply) => {
      // Rate limiting per endpoint
      const endpoint = request.url.split("/")[2] || "default";

      // Authentication/Authorization middleware
      const authHeader = request.headers.authorization;
      if (authHeader && !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid authorization header",
        });
      }
    },
    // Circuit breaker implementation
    onError: (reply) => {
      gateway.log.error("Proxy error:");

      if (!reply.sent) {
        reply.code(502).send({
          error: "Bad Gateway",
          message: "Unable to process request",
          requestId: reply.request.id,
          timestamp: new Date().toISOString(),
        });
      }
    },
  });

  // Fallback route
  gateway.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: "Not Found",
      message: `Route ${request.url} not found`,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  gateway.setErrorHandler((error, request, reply) => {
    gateway.log.error("Unhandled error:", error);

    const statusCode = error.statusCode || 500;

    const response = {
      error: statusCode === 500 ? "Internal Server Error" : error.name,
      message: error.message,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };

    if (env.nodeEnv === "development") {
      console.log(response);
    }

    reply.code(statusCode).send(response);
  });

  // Graceful shutdown
  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, async () => {
      gateway.log.info(`Received ${signal}, starting graceful shutdown`);

      await gateway.close();

      gateway.log.info("Gateway shutdown complete");
      process.exit(0);
    });
  });

  return gateway;
}

// Start gateway if this file is executed directly

(async () => {
  try {
    const gateway = await buildGateway();

    await gateway.listen({
      port: env.port,
      host: "0.0.0.0",
    });

    gateway.log.info(`Gateway listening on port ${env.port}`);
    gateway.log.info(`Proxying to ${env.backendUrl}`);
    gateway.log.info(`Environment: ${env.nodeEnv}`);
  } catch (error) {
    console.error("Failed to start gateway:", error);
    process.exit(1);
  }
})();
