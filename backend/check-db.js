const { Database } = require('bun:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'db.sqlite');
const db = new Database(dbPath);

console.log('=== MONITORING INSTANCES ===');
const instances = db.query('SELECT * FROM monitoring_instances').all();
console.log('Found instances:', instances.length);
instances.forEach(inst => console.log(JSON.stringify(inst, null, 2)));

console.log('\n=== INSTANCE CONFIG ===');
const configs = db.query('SELECT * FROM instance_config').all();
console.log('Found configs:', configs.length);
configs.forEach(config => console.log(JSON.stringify(config, null, 2)));

console.log('\n=== TESTING SYNC INSTANCES QUERY ===');
const syncInstances = db.query('SELECT * FROM monitoring_instances ORDER BY failover_order, created_at').all();
console.log('Sync instances query result:', syncInstances.length);
syncInstances.forEach(inst => console.log(JSON.stringify(inst, null, 2)));

console.log('\n=== USERS IN DATABASE ===');
const users = db.query('SELECT id, username, email, role, is_active, last_login FROM users').all();
console.log('Users found:', users.length);
users.forEach(user => console.log(JSON.stringify(user, null, 2)));

db.close();