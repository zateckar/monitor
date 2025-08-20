import { Database } from 'bun:sqlite';
import { DB_PATH } from './constants';

export function initializeDatabase(): Database {
  const db = new Database(DB_PATH);

  // Create all tables
  createTables(db);
  
  // Run migrations to add missing columns
  runMigrations(db);

  return db;
}

function createTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      last_checked DATETIME,
      heartbeat_interval INTEGER DEFAULT 60,
      retries INTEGER DEFAULT 3,
      failed_attempts INTEGER DEFAULT 0,
      upside_down_mode BOOLEAN DEFAULT false,
      paused BOOLEAN DEFAULT false,
      
      -- HTTP specific
      http_method TEXT DEFAULT 'GET',
      http_headers TEXT,
      http_body TEXT,
      ok_http_statuses TEXT,
      check_cert_expiry BOOLEAN DEFAULT false,
      cert_expiry_threshold INTEGER DEFAULT 30,
      keyword_search TEXT,

      -- mTLS (Client Certificates) - for HTTP and Kafka
      client_cert_enabled BOOLEAN DEFAULT false,
      client_cert_public_key TEXT,
      client_cert_private_key TEXT,
      client_cert_ca TEXT,

      -- TCP specific
      tcp_port INTEGER,

      -- Kafka specific
      kafka_topic TEXT,
      kafka_message TEXT,
      kafka_config TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_notification_services (
      monitor_id INTEGER,
      notification_service_id INTEGER,
      PRIMARY KEY (monitor_id, notification_service_id),
      FOREIGN KEY(monitor_id) REFERENCES endpoints(id) ON DELETE CASCADE,
      FOREIGN KEY(notification_service_id) REFERENCES notification_services(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS response_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER,
      response_time INTEGER,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(endpoint_id) REFERENCES endpoints(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS application_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      component TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS status_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_public BOOLEAN DEFAULT true,
      monitor_ids TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Authentication tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      oidc_provider_id INTEGER,
      oidc_subject TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      FOREIGN KEY(oidc_provider_id) REFERENCES oidc_providers(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS oidc_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      issuer_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      scopes TEXT DEFAULT 'openid profile email',
      redirect_base_url TEXT DEFAULT 'http://localhost:3001',
      use_pkce BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // OIDC state storage for persistent authentication flows
  db.exec(`
    CREATE TABLE IF NOT EXISTS oidc_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT UNIQUE NOT NULL,
      provider_id INTEGER NOT NULL,
      code_verifier TEXT,
      nonce TEXT,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(provider_id) REFERENCES oidc_providers(id) ON DELETE CASCADE
    )
  `);
}

function runMigrations(db: Database): void {
  // Add missing columns to existing endpoints table if they don't exist
  const migrations = [
    'ALTER TABLE endpoints ADD COLUMN paused BOOLEAN DEFAULT false',
    'ALTER TABLE endpoints ADD COLUMN client_cert_enabled BOOLEAN DEFAULT false',
    'ALTER TABLE endpoints ADD COLUMN client_cert_public_key TEXT',
    'ALTER TABLE endpoints ADD COLUMN client_cert_private_key TEXT',
    'ALTER TABLE endpoints ADD COLUMN client_cert_ca TEXT',
    'ALTER TABLE endpoints ADD COLUMN last_checked DATETIME',
    'ALTER TABLE oidc_providers ADD COLUMN redirect_base_url TEXT DEFAULT \'http://localhost:3001\'',
    'ALTER TABLE oidc_providers ADD COLUMN use_pkce BOOLEAN DEFAULT true',
    'ALTER TABLE endpoints ADD COLUMN kafka_consumer_read_single BOOLEAN DEFAULT false',
    'ALTER TABLE endpoints ADD COLUMN kafka_consumer_auto_commit BOOLEAN DEFAULT true',
    'ALTER TABLE endpoints ADD COLUMN cert_expires_in INTEGER',
    'ALTER TABLE endpoints ADD COLUMN cert_expiry_date DATETIME',
    'ALTER TABLE endpoints ADD COLUMN cert_check_interval INTEGER DEFAULT 21600'
  ];

  for (const migration of migrations) {
    try {
      db.exec(migration);
    } catch (err) {
      // Column already exists or other migration issue, ignore error
    }
  }
}
