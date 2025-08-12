# Use Bun runtime as base image
FROM oven/bun:1 AS base
WORKDIR /app

# Copy package files
COPY package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install dependencies for both frontend and backend
RUN cd frontend && bun install --frozen-lockfile
RUN cd backend && bun install --frozen-lockfile

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun --cwd backend -e "fetch('http://localhost:3001/api/endpoints').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["bun", "start"]
