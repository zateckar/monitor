import { serve } from "bun";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

const PORT = 4173;

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Try to serve static files from dist directory
    const filePath = join(process.cwd(), "dist", url.pathname.slice(1));
    
    // Check if file exists
    if (existsSync(filePath) && !filePath.endsWith("/")) {
      try {
        const file = Bun.file(filePath);
        const contentType = getContentType(url.pathname);
        
        return new Response(file, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000", // Cache for 1 year for static assets
          },
        });
      } catch (error) {
        console.error("Error serving static file:", error);
      }
    }

    // For all other routes, serve the main HTML file (SPA routing)
    try {
      const indexPath = join(process.cwd(), "dist", "index.html");
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, "utf-8");
        return new Response(html, {
          headers: {
            "Content-Type": "text/html",
            "Cache-Control": "no-cache", // Don't cache HTML
          },
        });
      } else {
        return new Response("Build not found. Run 'bun run build' first.", { 
          status: 404,
          headers: { "Content-Type": "text/plain" }
        });
      }
    } catch (error) {
      console.error("Error serving HTML:", error);
      return new Response("Error loading page", { status: 500 });
    }
  },
  error() {
    return new Response("Not found", { status: 404 });
  },
});

function getContentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
      return 'application/javascript';
    case 'css':
      return 'text/css';
    case 'html':
      return 'text/html';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    default:
      return 'text/plain';
  }
}

console.log(`🚀 Frontend preview server running on http://localhost:${PORT}`);
console.log(`📁 Serving static files from ./dist`);
