/**
 * Database utility functions for handling type conversions and common operations
 */

/**
 * Converts SQLite integer values to proper JavaScript booleans
 * SQLite stores booleans as 0/1 integers, this ensures proper conversion
 * @param value - The value from SQLite (could be 0, 1, null, undefined)
 * @returns Proper boolean value
 */
export function sqliteToBoolean(value: any): boolean {
  return Boolean(value);
}

/**
 * Converts an endpoint object from SQLite with proper boolean conversions
 * @param endpoint - Raw endpoint object from SQLite
 * @returns Endpoint object with proper boolean values
 */
export function convertEndpointBooleans(endpoint: any): any {
  return {
    ...endpoint,
    paused: sqliteToBoolean(endpoint.paused),
    upside_down_mode: sqliteToBoolean(endpoint.upside_down_mode),
    check_cert_expiry: sqliteToBoolean(endpoint.check_cert_expiry),
    client_cert_enabled: sqliteToBoolean(endpoint.client_cert_enabled),
    kafka_consumer_read_single: sqliteToBoolean(endpoint.kafka_consumer_read_single),
    kafka_consumer_auto_commit: sqliteToBoolean(endpoint.kafka_consumer_auto_commit),
  };
}

/**
 * Extracts and converts boolean fields from a database query result
 * @param result - Database query result
 * @param fields - Array of field names that should be converted to booleans
 * @returns Object with converted boolean values
 */
export function extractBooleanFields(result: any, fields: string[]): Record<string, boolean> {
  const booleans: Record<string, boolean> = {};
  for (const field of fields) {
    booleans[field] = sqliteToBoolean(result?.[field]);
  }
  return booleans;
}
