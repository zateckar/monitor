Use Bun instead of Node/npm.
This application uses Vite as the frontend bundler with Bun as the runtime. The frontend static files are served from the backend server. Use command "bun start" in the root to start the application on http://localhost:3001

For development:
- `bun dev` - Starts both backend and frontend servers concurrently (recommended for development)
- `bun dev:backend` - Starts only the backend server on http://localhost:3001
- `bun dev:frontend` - Starts only the Vite dev server on http://localhost:5173 with API proxy to backend
- `bun start` - Builds frontend with Vite and serves from backend on http://localhost:3001

Note: For development, you need both servers running. Use `bun dev` to start both, or run `bun dev:backend` and `bun dev:frontend` in separate terminals.
