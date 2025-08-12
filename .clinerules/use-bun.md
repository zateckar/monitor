Use Bun instead of Node/npm.
This application uses Bun as the runtime and frontend bundler. The frontend static files are served from the backend server. Use command "bun start" in the root to start the application on http://localhost:3001

For development:
- `bun dev` - Starts both backend and frontend servers concurrently (recommended for development)
- `bun dev:backend` - Starts only the backend server on http://localhost:3001
- `bun dev:frontend` - Starts only the Bun dev server on http://localhost:5173 with API proxy to backend and TypeScript transpilation
- `bun start` - Builds frontend with Bun bundler and serves from backend on http://localhost:3001

For production:
- `bun build` - Builds the frontend using Bun's bundler with minification and code splitting
- `bun preview` - Builds and serves the production build locally for testing
 