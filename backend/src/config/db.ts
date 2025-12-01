import mongoose from 'mongoose';
import { envConfig } from './envConfig';

const connectionOptions = {
  dbName: envConfig.mongodbDbName,
  autoIndex: envConfig.isDevelopment, // Auto-create indexes in development only
  maxPoolSize: 10, // Maximum number of sockets in the connection pool
  minPoolSize: 2, // Minimum number of sockets in the connection pool
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  serverSelectionTimeoutMS: 5000, // Timeout for server selection
  heartbeatFrequencyMS: 10000, // Send heartbeat every 10 seconds
  retryWrites: true,
  retryReads: true,
} as mongoose.ConnectOptions;

let isConnected = false;
let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected) {
    return mongoose;
  }

  // Prevent multiple connection attempts
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose.connect(envConfig.mongodbUri, connectionOptions);

  try {
    const connection = await connectionPromise;

    // Connection events
    mongoose.connection.on('connected', () => {
      console.log('MongoDB connected successfully');
      isConnected = true;
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      await disconnectDB();
      process.exit(0);
    });

    return connection;
  } catch (error) {
    connectionPromise = null;
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('MongoDB disconnected');
  }
}

export function getConnectionStatus(): string {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

// Health check helper
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}