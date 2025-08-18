import { Kafka, logLevel } from 'kafkajs-fixes';
import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { LoggerService } from './logger';

export class KafkaService {
  // Store persistent Kafka connections for each endpoint
  private kafkaConnections = new Map<number, {
    kafka: any;
    producer?: any;
    consumer?: any;
    isConnected: boolean;
    lastError?: string;
  }>();

  constructor(private db: Database, private logger: LoggerService) {}

  // Function to get or create a persistent Kafka connection
  async getKafkaConnection(endpoint: Endpoint): Promise<any> {
    const existingConnection = this.kafkaConnections.get(endpoint.id);

    // If we already have a healthy connection, return it
    if (existingConnection && existingConnection.isConnected && !existingConnection.lastError) {
      await this.logger.debug(`[Kafka-${endpoint.name}] Using existing connection`, 'KAFKA');
      return existingConnection;
    }

    // Create new connection
    const kafkaConfig = endpoint.kafka_config ? JSON.parse(endpoint.kafka_config) : {};
    
    const kafkaLogCreator = () => {
      return (logEntry: any) => {
        const level = logEntry.level;
        const message = logEntry.log?.message || 'Kafka log entry';
        const namespace = logEntry.namespace || '';
        const label = logEntry.label || '';
        
        const logMessage = `[Kafka-${endpoint.name}] ${namespace}${label ? ` ${label}` : ''}: ${message}`;
        
        switch (level) {
          case 'ERROR':
            this.logger.error(logMessage, 'KAFKA');
            break;
          case 'WARN':
            this.logger.warn(logMessage, 'KAFKA');
            break;
          case 'INFO':
            this.logger.debug(logMessage, 'KAFKA');
            break;
          case 'DEBUG':
            this.logger.debug(logMessage, 'KAFKA');
            break;
          default:
            this.logger.debug(logMessage, 'KAFKA');
        }
      };
    };
    
    // Validate and sanitize timeout values from kafkaConfig
    const sanitizedKafkaConfig = { ...kafkaConfig };
    
    // List of timeout properties that must be positive integers
    const timeoutProperties = [
      'connectionTimeout',
      'requestTimeout', 
      'sessionTimeout',
      'heartbeatInterval',
      'transactionTimeout',
      'authenticationTimeout',
      'reauthenticationThreshold'
    ];
    
    // Remove or fix any negative or invalid timeout values
    for (const prop of timeoutProperties) {
      if (sanitizedKafkaConfig[prop] !== undefined) {
        const value = sanitizedKafkaConfig[prop];
        if (typeof value !== 'number' || value < 0 || !Number.isFinite(value)) {
          this.logger.warn(`[Kafka-${endpoint.name}] Invalid ${prop} value (${value}) removed from config`, 'KAFKA');
          delete sanitizedKafkaConfig[prop];
        }
      }
    }

    // Also remove any properties that might interfere with KafkaJS internal timing
    const problematicProperties = [
      'timeout', 'Timeout', 'TIMEOUT',
      'createdAt', 'created_at', 'timestamp', 'time',
      'startTime', 'endTime', 'startedAt', 'endedAt'
    ];
    
    for (const prop of problematicProperties) {
      if (sanitizedKafkaConfig[prop] !== undefined) {
        this.logger.warn(`[Kafka-${endpoint.name}] Removing potentially problematic property ${prop} from Kafka config`, 'KAFKA');
        delete sanitizedKafkaConfig[prop];
      }
    }

    const kafkaOptions: any = {
      clientId: `monitor-app-${endpoint.id}`,
      brokers: [endpoint.url],
      logLevel: logLevel.INFO,
      logCreator: kafkaLogCreator,
      connectionTimeout: 10000,
      requestTimeout: 25000,
      retry: {
        initialRetryTime: 100,
        retries: 3
      },
      ...sanitizedKafkaConfig,
    };

    // Final validation: ensure no timeout values are negative after merging
    for (const prop of timeoutProperties) {
      if (kafkaOptions[prop] !== undefined) {
        const value = kafkaOptions[prop];
        if (typeof value !== 'number' || value < 0 || !Number.isFinite(value)) {
          this.logger.warn(`[Kafka-${endpoint.name}] Resetting invalid ${prop} value (${value}) to default`, 'KAFKA');
          if (prop === 'connectionTimeout') kafkaOptions[prop] = 10000;
          else if (prop === 'requestTimeout') kafkaOptions[prop] = 25000;
          else if (prop === 'sessionTimeout') kafkaOptions[prop] = 25000;
          else if (prop === 'heartbeatInterval') kafkaOptions[prop] = 3000;
          else if (prop === 'transactionTimeout') kafkaOptions[prop] = 30000;
          else delete kafkaOptions[prop];
        }
      }
    }

    if (endpoint.client_cert_enabled && endpoint.client_cert_private_key && endpoint.client_cert_public_key) {
      await this.logger.debug(`[Kafka-${endpoint.name}] Using mTLS client certificates`, 'KAFKA');
      kafkaOptions.ssl = {
        cert: endpoint.client_cert_public_key,
        key: endpoint.client_cert_private_key,
        rejectUnauthorized: true,
      };

      if (endpoint.client_cert_ca) {
        kafkaOptions.ssl.ca = endpoint.client_cert_ca;
      }
    }

    const kafka = new Kafka(kafkaOptions);
    const connection: {
      kafka: any;
      producer?: any;
      consumer?: any;
      isConnected: boolean;
      lastError?: string;
    } = {
      kafka,
      isConnected: false,
      lastError: undefined
    };

    try {
      if (endpoint.type === 'kafka_producer') {
        await this.logger.debug(`[Kafka-${endpoint.name}] Creating persistent producer connection`, 'KAFKA');
        const producer = kafka.producer({
          maxInFlightRequests: 1,
          idempotent: false,
          transactionTimeout: 30000,
        });
        
        await producer.connect();
        connection.producer = producer;
        connection.isConnected = true;
        await this.logger.info(`[Kafka-${endpoint.name}] Producer connected and ready for monitoring`, 'KAFKA');
        
      } else { // kafka_consumer
        await this.logger.debug(`[Kafka-${endpoint.name}] Creating persistent consumer connection`, 'KAFKA');
        
        // Configure consumer with autocommit option
        const consumerConfig: any = { 
          groupId: `monitor-app-${endpoint.id}`, // Fixed group ID for persistent connection
          sessionTimeout: 25000,
          heartbeatInterval: 3000,
        };
        
        // Set autocommit based on endpoint configuration (default: true)
        if (endpoint.kafka_consumer_auto_commit !== undefined) {
          consumerConfig.enableAutoCommit = endpoint.kafka_consumer_auto_commit;
          await this.logger.debug(`[Kafka-${endpoint.name}] Consumer autocommit set to: ${endpoint.kafka_consumer_auto_commit}`, 'KAFKA');
        }
        
        const consumer = kafka.consumer(consumerConfig);
        
        await consumer.connect();
        await consumer.subscribe({ 
          topics: [endpoint.kafka_topic!]
        });
        
        connection.consumer = consumer;
        connection.isConnected = true;
        await this.logger.info(`[Kafka-${endpoint.name}] Consumer connected and subscribed to topic ${endpoint.kafka_topic}`, 'KAFKA');
      }

      this.kafkaConnections.set(endpoint.id, connection);
      return connection;
      
    } catch (error) {
      await this.logger.error(`[Kafka-${endpoint.name}] Failed to create persistent connection: ${error}`, 'KAFKA');
      connection.lastError = (error as Error).toString();
      this.kafkaConnections.set(endpoint.id, connection);
      throw error;
    }
  }

  // Function to check Kafka health using persistent connection
  async checkKafkaHealth(endpoint: Endpoint): Promise<{ isOk: boolean, responseTime: number }> {
    const startTime = Date.now();
    
    try {
      const connection = await this.getKafkaConnection(endpoint);
      
      if (endpoint.type === 'kafka_producer') {
        const message = endpoint.kafka_message || `monitor heartbeat from ${endpoint.id} at ${new Date().toISOString()}`;
        await this.logger.debug(`[Kafka-${endpoint.name}] Sending heartbeat message to topic ${endpoint.kafka_topic}`, 'KAFKA');
        
        const result = await connection.producer.send({
          topic: endpoint.kafka_topic!,
          messages: [{ 
            value: message,
            timestamp: Date.now().toString()
          }],
        });
        
        await this.logger.debug(`[Kafka-${endpoint.name}] Heartbeat message sent successfully`, 'KAFKA');
        const responseTime = Date.now() - startTime;
        return { isOk: true, responseTime };
        
      } else { // kafka_consumer
        await this.logger.debug(`[Kafka-${endpoint.name}] Checking consumer connection health`, 'KAFKA');
        
        // Check if we should read a single message or just verify connectivity
        if (endpoint.kafka_consumer_read_single) {
          // Read a single message from the topic
          await this.logger.debug(`[Kafka-${endpoint.name}] Reading single message from topic ${endpoint.kafka_topic}`, 'KAFKA');
          
          try {
            let messageReceived = false;
            const messageTimeout = 10000; // 10 second timeout for message reading
            
            // Set up a promise that resolves when we receive a message or timeout
            const messagePromise = new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                resolve(false); // No message received within timeout
              }, messageTimeout);
              
              connection.consumer.run({
                eachMessage: async ({ topic, partition, message }: any) => {
                  clearTimeout(timeout);
                  await this.logger.debug(`[Kafka-${endpoint.name}] Received message from topic ${topic}, partition ${partition}`, 'KAFKA');
                  
                  // If autocommit is disabled, manually commit the message
                  if (endpoint.kafka_consumer_auto_commit === false) {
                    await this.logger.debug(`[Kafka-${endpoint.name}] Manually committing message offset`, 'KAFKA');
                    await connection.consumer.commitOffsets([{
                      topic,
                      partition,
                      offset: (parseInt(message.offset) + 1).toString()
                    }]);
                  }
                  
                  resolve(true);
                  return; // Stop after processing one message
                },
              });
            });
            
            messageReceived = await messagePromise;
            
            if (messageReceived) {
              await this.logger.debug(`[Kafka-${endpoint.name}] Successfully read single message`, 'KAFKA');
              const responseTime = Date.now() - startTime;
              return { isOk: true, responseTime };
            } else {
              await this.logger.debug(`[Kafka-${endpoint.name}] No messages available within timeout`, 'KAFKA');
              // Still consider this healthy - no messages might be normal
              const responseTime = Date.now() - startTime;
              return { isOk: true, responseTime };
            }
          } catch (error) {
            await this.logger.error(`[Kafka-${endpoint.name}] Error reading single message: ${error}`, 'KAFKA');
            const responseTime = Date.now() - startTime;
            return { isOk: false, responseTime };
          }
        } else {
          // Standard health check - verify connectivity via admin client
          const admin = connection.kafka.admin();
          await admin.connect();
          
          try {
            // Try to get topic metadata to verify connectivity
            const metadata = await admin.fetchTopicMetadata({ topics: [endpoint.kafka_topic!] });
            await this.logger.debug(`[Kafka-${endpoint.name}] Consumer connection healthy - topic metadata fetched`, 'KAFKA');
            
            const responseTime = Date.now() - startTime;
            return { isOk: true, responseTime };
          } finally {
            await admin.disconnect();
          }
        }
      }
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      await this.logger.error(`[Kafka-${endpoint.name}] Health check failed: ${error}`, 'KAFKA');
      
      // Mark connection as unhealthy
      const connection = this.kafkaConnections.get(endpoint.id);
      if (connection) {
        connection.isConnected = false;
        connection.lastError = (error as Error).toString();
      }
      
      return { isOk: false, responseTime };
    }
  }

  // Function to cleanup Kafka connection
  async cleanupKafkaConnection(endpointId: number): Promise<void> {
    const connection = this.kafkaConnections.get(endpointId);
    if (!connection) return;

    try {
      if (connection.producer) {
        await connection.producer.disconnect();
        await this.logger.debug(`Kafka producer disconnected for endpoint ${endpointId}`, 'KAFKA');
      }
      if (connection.consumer) {
        await connection.consumer.stop();
        await connection.consumer.disconnect();
        await this.logger.debug(`Kafka consumer disconnected for endpoint ${endpointId}`, 'KAFKA');
      }
    } catch (error) {
      await this.logger.error(`Error cleaning up Kafka connection for endpoint ${endpointId}: ${error}`, 'KAFKA');
    } finally {
      this.kafkaConnections.delete(endpointId);
    }
  }

  // Function to restart Kafka connection for an endpoint
  async restartKafkaConnection(endpoint: Endpoint): Promise<void> {
    await this.cleanupKafkaConnection(endpoint.id);
    // Connection will be recreated on next health check
  }
}
