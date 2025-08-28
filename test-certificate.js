// Simple test script to debug certificate extraction
import https from 'https';
import type { TLSSocket } from 'tls';

console.log('Testing certificate extraction for example.com');

const options = {
  host: 'example.com',
  port: 443,
  method: 'GET',
  timeout: 10000,
  rejectUnauthorized: false, // Important for self-signed or test certs
  headers: {
    'User-Agent': 'Bun-Certificate-Test/1.0'
  }
};

console.log('Creating HTTPS request with options:', JSON.stringify(options, null, 2));

const req = https.request(options, (res) => {
  console.log('HTTPS request successful, statusCode:', res.statusCode);
  const socket = res.socket as TLSSocket;
  
  if (!socket) {
    console.error('No socket available');
    req.destroy();
    return;
  }
  
  if (typeof socket.getPeerCertificate !== 'function') {
    console.error('getPeerCertificate method not available on the socket.');
    req.destroy();
    return;
  }

  console.log('Getting peer certificate...');
  // Pass `true` for the full certificate details including the chain
  const cert = socket.getPeerCertificate(true);
  
  if (!cert || Object.keys(cert).length === 0) {
    console.error('Empty or invalid certificate received.');
    req.destroy();
    return;
  }

  console.log('Peer certificate received:');
  console.log(JSON.stringify(cert, null, 2));
  
  req.destroy();
});

req.on('error', (error) => {
  console.error('HTTPS request error:', error.message);
  req.destroy();
});

req.on('timeout', () => {
  console.error('HTTPS request timeout');
  req.destroy();
});

req.end();
