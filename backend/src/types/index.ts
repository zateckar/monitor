export type MonitorType = 'http' | 'ping' | 'tcp' | 'kafka_producer' | 'kafka_consumer';

// Authentication types
export interface User {
  id: number;
  username: string;
  email?: string;
  password_hash?: string;
  role: 'admin' | 'user';
  oidc_provider_id?: number;
  oidc_subject?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login?: string;
}

export interface OIDCProvider {
  id: number;
  name: string;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  redirect_base_url: string;
  use_pkce: boolean;
  is_active: boolean;
  created_at: string;
}

export interface UserSession {
  id: number;
  user_id: number;
  session_token: string;
  expires_at: string;
  created_at: string;
}

export interface Endpoint {
  id: number;
  name: string;
  type: MonitorType;
  url: string; // For HTTP, it's the URL; for Ping/TCP, the host; for Kafka, the bootstrap server
  status: string;
  last_checked: string | null;
  heartbeat_interval: number;
  retries: number;
  failed_attempts: number;
  upside_down_mode: boolean;
  paused: boolean;

  // HTTP specific
  http_method?: string;
  http_headers?: string | null;
  http_body?: string | null;
  ok_http_statuses?: string | null;
  check_cert_expiry?: boolean;
  cert_expiry_threshold?: number;
  cert_check_interval?: number; // Custom interval for certificate checks in seconds
  cert_expires_in?: number | null;
  cert_expiry_date?: string | null;
  keyword_search?: string | null;

  // mTLS (Client Certificates) - for HTTP and Kafka
  client_cert_enabled?: boolean;
  client_cert_public_key?: string | null; // PEM format
  client_cert_private_key?: string | null; // PEM format
  client_cert_ca?: string | null; // PEM format

  // TCP specific
  tcp_port?: number;

  // Kafka specific
  kafka_topic?: string;
  kafka_message?: string; // For producer
  kafka_config?: string; // For consumer/producer specific configs
  kafka_consumer_read_single?: boolean; // For consumer: read only one message
  kafka_consumer_auto_commit?: boolean; // For consumer: enable/disable autocommit

  // Domain information monitoring
  domain_expires_in?: number | null;
  domain_expiry_date?: string | null;
  domain_creation_date?: string | null;
  domain_updated_date?: string | null;
}

// Distributed monitoring types
export interface InstanceConfig {
  // Instance Identity
  instanceName: string;
  instanceLocation?: string;

  // Security Settings
  sharedSecret?: string;

  // Dependent Instance Settings
  primarySyncURL?: string;
  failoverOrder?: number;

  // Connection Settings
  syncInterval?: number;
  heartbeatInterval?: number;
  connectionTimeout?: number;
}

export interface MonitoringInstance {
  id: number;
  instance_id: string;
  instance_name: string;
  location?: string;
  sync_url?: string;
  failover_order: number;
  last_heartbeat?: string;
  status: 'active' | 'inactive' | 'failed' | 'promoting';
  capabilities?: string[];
  system_info?: SystemInfo;
  connection_info?: ConnectionInfo;
  created_at: string;
  updated_at: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  memory: number;
  cpu: number;
  uptime: number;
}

export interface ConnectionInfo {
  primaryReachable: boolean;
  lastSyncSuccess?: string;
  syncErrors: number;
  latency?: number;
}

export interface InstanceRegistration {
  instanceId: string;
  instanceName: string;
  location?: string;
  version: string;
  capabilities: string[];
  failoverOrder: number;
  publicEndpoint?: string;
  systemInfo: SystemInfo;
}

export interface HeartbeatPayload {
  instanceId: string;
  timestamp: string;
  status: 'healthy' | 'degraded' | 'failing';
  uptime: number;
  monitoringResults: MonitoringResult[];
  systemMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    activeEndpoints: number;
  };
  connectionStatus: ConnectionInfo;
}

export interface MonitoringResult {
  endpointId: number;
  instanceId: string;
  timestamp: string;
  isOk: boolean;
  responseTime: number;
  status: 'UP' | 'DOWN';
  failureReason?: string;
  location: string;
  checkType: MonitorType;
  metadata?: {
    httpStatus?: number;
    certificateInfo?: any;
    kafkaMetrics?: any;
  };
}

export interface SyncConfiguration {
  endpoints: Endpoint[];
  notificationServices: any[];
  globalSettings: any;
  lastModified: string;
  configVersion: number;
}

export interface AggregatedResult {
  id: number;
  endpoint_id: number;
  timestamp: string;
  total_locations: number;
  successful_locations: number;
  avg_response_time: number;
  min_response_time: number;
  max_response_time: number;
  consensus_status: 'UP' | 'DOWN' | 'PARTIAL';
  location_results: Record<string, MonitoringResult>;
}

export interface InstanceToken {
  id: number;
  instance_id: string;
  token_hash: string;
  expires_at?: string;
  created_at: string;
  last_used?: string;
  permissions: string[];
}
