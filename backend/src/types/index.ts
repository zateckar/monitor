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
}
