import tls from 'tls';

export class CertificateService {
  async getCertificateExpiry(hostname: string): Promise<{ daysRemaining: number } | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket?.destroy();
        resolve(null);
      }, 10000); // 10 second timeout

      let socket: tls.TLSSocket | null = null;
      
      try {
        socket = tls.connect({
          host: hostname,
          port: 443,
          servername: hostname,
          timeout: 8000, // 8 second connection timeout
          rejectUnauthorized: false // Don't reject self-signed or invalid certs, we just want expiry info
        }, () => {
          clearTimeout(timeout);
          
          try {
            const cert = socket?.getPeerCertificate();
            if (cert && cert.valid_to) {
              const validTo = new Date(cert.valid_to);
              const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              resolve({ daysRemaining });
            } else {
              resolve(null);
            }
          } catch (err) {
            // Error getting certificate info, just return null
            resolve(null);
          } finally {
            socket?.end();
          }
        });

        socket.on('error', () => {
          // On any TLS/SSL error, just resolve with null
          // This prevents the application from crashing on problematic certificates
          clearTimeout(timeout);
          socket?.destroy();
          resolve(null);
        });

        socket.on('timeout', () => {
          clearTimeout(timeout);
          socket?.destroy();
          resolve(null);
        });
        
      } catch (err) {
        // Any other error during connection setup
        clearTimeout(timeout);
        socket?.destroy();
        resolve(null);
      }
    });
  }
}
