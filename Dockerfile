# ---- Builder Stage ----
FROM oven/bun:alpine AS builder
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY backend/package.json backend/bun.lock* ./backend/
COPY frontend/package.json frontend/bun.lock* ./frontend/

# Install all dependencies
RUN cd frontend && bun install --frozen-lockfile
RUN cd backend && bun install --frozen-lockfile

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend
RUN cd frontend && bun run build

# ---- Production Stage ----
FROM oven/bun:alpine AS production
WORKDIR /app

# Copy backend package files
COPY backend/package.json backend/bun.lock* ./backend/

# Install production backend dependencies
RUN cd backend && bun install --frozen-lockfile --production

# Copy built frontend from builder stage
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy backend source from builder stage
COPY --from=builder /app/backend ./backend

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Create and use non-root user
RUN addgroup -S appuser && adduser -S appuser -G appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3001

# Start the application
CMD ["bun", "run", "backend/index.ts"]