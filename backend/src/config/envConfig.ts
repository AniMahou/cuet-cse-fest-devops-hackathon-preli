import { Type, Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import dotenv from 'dotenv';

dotenv.config();

// Environment schema validation
const EnvSchema = Type.Object({
  // Server
  NODE_ENV: Type.Union([
    Type.Literal('development'),
    Type.Literal('testing'),
    Type.Literal('production'),
  ]),
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Number({ default: 3000 }),

  // Database
  MONGODB_URI: Type.String({ minLength: 1 }),
  MONGODB_DB_NAME: Type.String({ default: 'product_db' }),

  // Redis
  REDIS_URL: Type.Optional(Type.String()),

  // JWT
  JWT_SECRET: Type.String({ minLength: 32 }),

  // CORS
  CORS_ORIGINS: Type.String({ default: '*' }),

  // Rate limiting
  RATE_LIMIT_MAX: Type.Number({ default: 100 }),

  // Logging
  LOG_LEVEL: Type.Union([
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
    Type.Literal('silent'),
  ], { default: 'info' }),
});

export type Env = Static<typeof EnvSchema>;

// Compile schema for validation
const C = TypeCompiler.Compile(EnvSchema);

export function validateEnv(): void {
  const env = process.env as any;

  if (!C.Check(env)) {
    const errors = [...C.Errors(env)];
    console.error('Environment validation failed:');
    errors.forEach(err => {
      console.error(`  ${err.path}: ${err.message}`);
    });
    throw new Error('Invalid environment configuration');
  }
}

// Export validated configuration
export const envConfig = {
  nodeEnv: process.env.NODE_ENV as Env['NODE_ENV'],
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000'),
  mongodbUri: process.env.MONGODB_URI!,
  mongodbDbName: process.env.MONGODB_DB_NAME || 'product_db',
  redisUrl: process.env.REDIS_URL,
  jwtSecret: process.env.JWT_SECRET!,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || '*',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  logLevel: process.env.LOG_LEVEL as Env['LOG_LEVEL'],

  // Derived configurations
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTesting: process.env.NODE_ENV === 'testing',
} as const;