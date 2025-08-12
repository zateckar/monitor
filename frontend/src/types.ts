export type MonitorType = 'http' | 'ping' | 'tcp' | 'kafka_producer' | 'kafka_consumer';

export interface Endpoint {
  id: number | string;
  name: string;
  type: MonitorType;
  url: string; // For HTTP, it's the URL; for Ping/TCP, the host; for Kafka, the bootstrap server
  status: string;
  created_at: string;
  updated_at: string;
  last_checked: string;
  current_response: number;
  avg_response_24h: number;
  uptime_24h: number;
  uptime_30d: number | null | undefined;
  uptime_1y: number | null | undefined;
  cert_expires_in: number | null;
  cert_expiry_date: string | null;
  heartbeat_interval: number;
  retries: number;
  upside_down_mode: boolean;
  paused: boolean;

  // HTTP specific
  http_method?: string;
  http_headers?: string | null;
  http_body?: string | null;
  ok_http_statuses?: string[] | null;
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
}

export interface ResponseTime {
  id: number;
  endpoint_id: number;
  response_time: number;
  created_at: string;
}

export interface NotificationService {
  id: number;
  name: string;
  type: 'telegram' | 'sendgrid' | 'slack' | 'apprise';
  config: {
    botToken?: string;
    chatId?: string;
    apiKey?: string;
    toEmail?: string;
    fromEmail?: string;
    webhookUrl?: string;
    serverUrl?: string;
    notificationUrls?: string;
  };
}

export interface Outage {
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  duration_text: string;
  reason: string;
}

export interface Heartbeat {
  status: string;
  created_at: string;
  response_time: number;
}

export interface StatusPage {
  id: number;
  name: string;
  slug: string;
  description?: string;
  is_public: boolean;
  monitor_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  username: string;
  email?: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  last_login?: string;
}

export interface AuthResponse {
  success: boolean;
  user: User;
  token: string;
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
