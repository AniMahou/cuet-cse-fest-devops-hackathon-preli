import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FastifyPluginAsync } from 'fastify';

// Cache configuration
const CACHE_CONFIG = {
  DEFAULT_TTL: 300, // 5 minutes
  MAX_TTL: 3600, // 1 hour
  KEY_PREFIX: 'cache:',
};

// Cache key generator
function generateCacheKey(prefix: string, ...parts: string[]): string {
  return `${CACHE_CONFIG.KEY_PREFIX}${prefix}:${parts.join(':')}`;
}

// Cache decorator interface
interface CacheOptions {
  ttl?: number;
  key: string;
}

// Cache methods interface
interface CacheMethods {
  get: <T,>(key: string) => Promise<T | null>;
  set: <T,>(key: string, value: T, ttl?: number) => Promise<void>;
  delete: (key: string) => Promise<void>;
  deleteByPattern: (pattern: string) => Promise<void>;
  generateKey: (prefix: string, ...parts: string[]) => string;
}

// Get cached value
async function getCached<T>(redis: any, key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

// Set cached value
async function setCached<T>(
  redis: any,
  key: string,
  value: T,
  ttl: number = CACHE_CONFIG.DEFAULT_TTL
): Promise<void> {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

// Delete cached value
async function deleteCached(redis: any, key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}

// Delete cached values by pattern
async function deleteCachedByPattern(redis: any, pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys && keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Cache delete by pattern error:', error);
  }
}

// Cache decorator for routes
function cacheRoute(options: CacheOptions) {
  return async (request: FastifyRequest, reply: FastifyReply, done: any) => {
    const redis = (request.server as any).redis;

    if (!redis) {
      return done();
    }

    const cacheKey = options.key;
    const ttl = options.ttl || CACHE_CONFIG.DEFAULT_TTL;

    // Check cache for GET requests only
    if (request.method === 'GET') {
      try {
        const cached = await getCached(redis, cacheKey);
        if (cached) {
          reply.header('X-Cache', 'HIT');
          return reply.send(cached);
        }
      } catch (error) {
        request.log.error('Cache check failed:');
      }
    }

    // Wrap reply.send to cache successful responses
    const originalSend = reply.send.bind(reply);
    reply.send = function (payload: any) {
      if (request.method === 'GET' && reply.statusCode === 200 && redis) {
        setCached(redis, cacheKey, payload, ttl).catch(err => {
          request.log.error('Cache set failed:', err);
        });
      }
      reply.header('X-Cache', 'MISS');
      return originalSend(payload);
    };

    done();
  };
}

// Cache plugin
export const cachePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const redis = (app as any).redis;

  if (!redis) {
    app.log.warn('Redis not connected, cache plugin disabled');
    return;
  }

  // Create cache methods object
  const cacheMethods: CacheMethods = {
    get: <T,>(key: string) => getCached<T>(redis, key),
    set: <T,>(key: string, value: T, ttl?: number) =>
      setCached<T>(redis, key, value, ttl),
    delete: (key: string) => deleteCached(redis, key),
    deleteByPattern: (pattern: string) => deleteCachedByPattern(redis, pattern),
    generateKey: generateCacheKey,
  };

  // Extend app instance with cache methods
  app.decorate('cache', cacheMethods);

  // Add cache decorator to request
  app.addHook('onRequest', async (request) => {
    (request as any).cache = cacheMethods;
  });

  app.log.info('Cache plugin initialized');
};

// Export utilities for manual cache management
export {
  getCached,
  setCached,
  deleteCached,
  deleteCachedByPattern,
  generateCacheKey,
  cacheRoute,
  CACHE_CONFIG,
};