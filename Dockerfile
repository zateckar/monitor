# Use Bun runtime as base image
FROM oven/bun:1 AS base
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY backend/package.json backend/bun.lock* ./backend/
COPY frontend/package.json frontend/bun.lock* ./frontend/

# Install dependencies for both frontend and backend
RUN cd frontend && bun install --frozen-lockfile
RUN cd backend && bun install --frozen-lockfile

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend with Bun bundler
RUN cd frontend && bun run build

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3001

# Start the application
CMD ["bun", "start"]
