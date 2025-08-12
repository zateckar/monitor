import { serve } from "bun";
import { join } from "path";
import { readFileSync } from "fs";

const PORT = 5173;
const BACKEND_URL = "http://localhost:3001";

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Proxy API requests to backend
    if (url.pathname.startsWith("/api")) {
      const backendUrl = `${BACKEND_URL}${url.pathname}${url.search}`;
      return fetch(backendUrl, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }

    // Serve static assets and transpile TypeScript
    if (url.pathname.startsWith("/src/") || url.pathname.endsWith(".css") || url.pathname.endsWith(".js") || url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx")) {
      try {
        const filePath = join(process.cwd(), url.pathname.slice(1));
        const file = Bun.file(filePath);
        
        if (await file.exists()) {
          // Handle TypeScript files - transpile them
          if (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx")) {
            const transpiled = await Bun.build({
              entrypoints: [filePath],
              target: "browser",
              minify: false,
              sourcemap: "inline",
              define: {
                "process.env.NODE_ENV": '"development"',
              },
            });
            
            if (transpiled.success && transpiled.outputs.length > 0) {
              const output = await transpiled.outputs[0].text();
              return new Response(output, {
                headers: {
                  "Content-Type": "application/javascript",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            } else {
              console.error("Transpilation failed:", transpiled.logs);
              return new Response("Transpilation failed", { status: 500 });
            }
          } else {
            // Handle other files normally
            const contentType = getContentType(url.pathname);
            return new Response(file, {
              headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        }
      } catch (error) {
        console.error("Error serving static file:", error);
      }
    }

    // For all other routes, serve the main HTML file (SPA routing)
    try {
      const htmlPath = join(process.cwd(), "index.html");
      let html = readFileSync(htmlPath, "utf-8");
      
      // Inject hot reload script
      const hotReloadScript = `
        <script>
          // Simple hot reload implementation
          let ws;
          function connectWS() {
            ws = new WebSocket('ws://localhost:${PORT + 1}');
            ws.onopen = () => console.log('Hot reload connected');
            ws.onmessage = (event) => {
              if (event.data === 'reload') {
                window.location.reload();
              }
            };
            ws.onclose = () => {
              console.log('Hot reload disconnected, retrying...');
              setTimeout(connectWS, 1000);
            };
          }
          connectWS();
        </script>
      `;
      
      html = html.replace("</head>", `${hotReloadScript}</head>`);
      
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    } catch (error) {
      console.error("Error serving HTML:", error);
      return new Response("Error loading page", { status: 500 });
    }
  },
  error() {
    return new Response("Not found", { status: 404 });
  },
});

// Simple WebSocket server for hot reload notifications
serve({
  port: PORT + 1,
  websocket: {
    message(_ws, _message) {
      // Echo back for now
    },
    open(_ws) {
      console.log("Hot reload client connected");
    },
    close(_ws) {
      console.log("Hot reload client disconnected");
    },
  },
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("WebSocket server", { status: 426 });
  },
});

function getContentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'application/javascript';
    case 'ts':
    case 'tsx':
      return 'application/typescript';
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
    default:
      return 'text/plain';
  }
}

console.log(`🚀 Frontend development server running on http://localhost:${PORT}`);
console.log(`📡 WebSocket server for hot reload on port ${PORT + 1}`);
console.log(`🔗 Proxying /api requests to ${BACKEND_URL}`);
