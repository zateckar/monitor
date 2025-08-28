// Test certificate extraction with better timeout handling for Bun
async function testCertificateExtraction() {
  console.log('Testing certificate extraction with Bun for example.com');
  
  try {
    // First test basic HTTPS connectivity
    console.log('1. Testing basic HTTPS connectivity...');
    const response = await fetch('https://example.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    console.log('✓ Basic HTTPS works, status:', response.status);
    
    // Test Node.js HTTPS module compatibility in Bun
    console.log('2. Testing Node.js HTTPS module in Bun...');
    const https = require('https');
    
    const testTLS = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('✗ HTTPS request timed out after 5 seconds');
        reject(new Error('Request timeout'));
      }, 5000);
      
      const options = {
        host: 'example.com',
        port: 443,
        method: 'GET',
        timeout: 3000,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Certificate-Monitor/1.0'
        }
      };
      
      console.log('Creating HTTPS request...');
      const req = https.request(options, (res) => {
        clearTimeout(timeout);
        console.log('✓ HTTPS request successful, status:', res.statusCode);
        
        const socket = res.socket;
        if (!socket) {
          req.destroy();
          reject(new Error('No socket available'));
          return;
        }
        
        if (typeof socket.getPeerCertificate !== 'function') {
          req.destroy();
          reject(new Error('getPeerCertificate method not available'));
          return;
        }
        
        try {
          const cert = socket.getPeerCertificate(false);
          console.log('Certificate keys:', Object.keys(cert));
          
          if (!cert || Object.keys(cert).length === 0) {
            req.destroy();
            reject(new Error('Empty certificate'));
            return;
          }
          
          const certInfo = {
            subject: cert.subject?.CN || 'unknown',
            issuer: cert.issuer?.CN || 'unknown',
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            serialNumber: cert.serialNumber
          };
          
          console.log('✓ Certificate extracted:', certInfo);
          req.destroy();
          resolve(certInfo);
          
        } catch (certError) {
          req.destroy();
          reject(new Error(`Certificate parsing failed: ${certError.message}`));
        }
      });
      
      req.on('error', (error) => {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error(`HTTPS request failed: ${error.message}`));
      });
      
      req.on('timeout', () => {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error('HTTPS request timeout'));
      });
      
      req.setTimeout(3000);
      req.end();
    });
    
    const certInfo = await testTLS();
    console.log('✓ Certificate extraction successful!');
    
  } catch (error) {
    console.log('✗ Certificate extraction failed:', error.message);
    
    // Test OpenSSL as fallback
    console.log('3. Testing OpenSSL fallback...');
    try {
      const { spawn } = require('child_process');
      
      const testOpenSSL = () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('OpenSSL timeout'));
        }, 10000);
        
        const openssl = spawn('openssl', [
          's_client', '-connect', 'example.com:443', 
          '-servername', 'example.com', '-showcerts'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        
        let output = '';
        
        openssl.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        openssl.on('close', (code) => {
          clearTimeout(timeout);
          if (output.includes('subject=')) {
            const subjectMatch = output.match(/subject=(.+)/);
            const issuerMatch = output.match(/issuer=(.+)/);
            console.log('✓ OpenSSL extraction successful');
            console.log('Subject:', subjectMatch?.[1] || 'unknown');
            console.log('Issuer:', issuerMatch?.[1] || 'unknown');
            resolve(true);
          } else {
            reject(new Error('No certificate info in OpenSSL output'));
          }
        });
        
        openssl.on('error', (error) => {
          clearTimeout(timeout);
          reject(new Error(`OpenSSL failed: ${error.message}`));
        });
        
        openssl.stdin.end();
      });
      
      await testOpenSSL();
      console.log('✓ OpenSSL fallback works');
      
    } catch (opensslError) {
      console.log('✗ OpenSSL fallback failed:', opensslError.message);
    }
  }
}

// Run the test
testCertificateExtraction().then(() => {
  console.log('Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
