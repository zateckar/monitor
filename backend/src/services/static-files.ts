import path from 'path';
import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { gzipSync } from 'bun';

export class StaticFileService {
  private readonly frontendDistPath: string;

  constructor() {
    this.frontendDistPath = path.join(import.meta.dir, '..', '..', '..', 'frontend', 'dist');
  }

  async serveFile(request: Request, set: any): Promise<Response> {
    const url = new URL(request.url);
    const assetPath = url.pathname === '/' ? 'index.html' : url.pathname.substring(1);
    const filePath = path.join(this.frontendDistPath, assetPath);

    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      try {
        const stats = await stat(filePath);
        const lastModified = stats.mtime.toUTCString();
        const etag = `"${createHash('md5').update(`${stats.size}-${stats.mtime.getTime()}`).digest('hex')}"`;
        
        // Check if client has cached version (304 Not Modified)
        const ifNoneMatch = request.headers.get('if-none-match');
        const ifModifiedSince = request.headers.get('if-modified-since');
        
        if (ifNoneMatch === etag || ifModifiedSince === lastModified) {
          set.status = 304;
          return new Response(null, { status: 304 });
        }
        
        // Determine file type and set appropriate cache headers and Content-Type
        const ext = path.extname(filePath).toLowerCase();
        let cacheControl: string;
        let contentType: string;
        
        // Set Content-Type based on file extension
        contentType = this.getContentType(ext);
        
        if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
          // Long cache for hashed assets (1 year)
          cacheControl = 'public, max-age=31536000, immutable';
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) {
          // Medium cache for images (1 week)
          cacheControl = 'public, max-age=604800';
        } else {
          // Short cache for HTML and other files (1 hour)
          cacheControl = 'public, max-age=3600';
        }
        
        // Set security and performance headers
        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
          'ETag': etag,
          'Last-Modified': lastModified,
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block'
        };
        
        // Add compression for text-based files
        const acceptEncoding = request.headers.get('accept-encoding') || '';
        const isCompressible = ['.js', '.css', '.html', '.json', '.xml', '.txt', '.svg'].includes(ext);
        
        if (isCompressible && acceptEncoding.includes('gzip')) {
          try {
            const fileContent = await file.arrayBuffer();
            const compressed = gzipSync(new Uint8Array(fileContent));
            headers['Content-Encoding'] = 'gzip';
            headers['Content-Length'] = compressed.length.toString();
            
            return new Response(compressed, { headers });
          } catch (compressionError) {
            // Fall back to uncompressed if compression fails
            console.warn('Compression failed, serving uncompressed:', compressionError);
          }
        }
        
        return new Response(file, { headers });
      } catch (error) {
        // If stat fails, serve file without caching headers
        console.warn('Failed to get file stats, serving without optimization:', error);
        return new Response(file);
      }
    }

    // Fallback to index.html for SPA routing (with appropriate headers)
    const indexPath = path.join(this.frontendDistPath, 'index.html');
    const indexFile = Bun.file(indexPath);
    
    if (await indexFile.exists()) {
      const headers = {
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block'
      };
      
      return new Response(indexFile, { headers });
    }
    
    // Final fallback - 404
    set.status = 404;
    return new Response('Not Found', { status: 404 });
  }

  private getContentType(ext: string): string {
    switch (ext) {
      case '.html':
        return 'text/html; charset=utf-8';
      case '.css':
        return 'text/css; charset=utf-8';
      case '.js':
        return 'application/javascript; charset=utf-8';
      case '.json':
        return 'application/json; charset=utf-8';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.svg':
        return 'image/svg+xml; charset=utf-8';
      case '.ico':
        return 'image/x-icon';
      case '.webp':
        return 'image/webp';
      case '.woff':
        return 'font/woff';
      case '.woff2':
        return 'font/woff2';
      case '.ttf':
        return 'font/ttf';
      case '.eot':
        return 'application/vnd.ms-fontobject';
      case '.xml':
        return 'application/xml; charset=utf-8';
      case '.txt':
        return 'text/plain; charset=utf-8';
      default:
        return 'application/octet-stream';
    }
  }
}
