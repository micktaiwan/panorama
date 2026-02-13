# --- Build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Install su-exec for entrypoint user switching
RUN apk add --no-cache su-exec

# Create non-root user
RUN addgroup -g 1002 -S appgroup && \
    adduser -u 1002 -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev

# Copy build output
COPY --from=builder /app/dist ./dist

# Create upload and log directories
RUN mkdir -p /app/public/uploads/images /app/public/uploads/files /app/public/uploads/videos /app/logs && \
    chown -R appuser:appgroup /app

# Copy entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3002

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
