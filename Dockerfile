# ───────────────────────────────────────────────
# MediCare Backend — Production Docker image
# Suitable for Fly.io / Render / Railway free tiers.
# The /data volume is mounted at runtime so the SQLite DB persists across restarts.
# ───────────────────────────────────────────────

FROM node:22-slim

# OpenSSL + libc6 needed by better-sqlite3 native binaries on slim images
RUN apt-get update && apt-get install -y --no-install-recommends \
    libc6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

# Persistent data directory (mount a volume here in prod)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/medical.db

EXPOSE 4000

# Dumb-init for proper signal handling (PID 1)
# (If dumb-init isn't available, the Node SIGTERM handler still works.)
CMD ["node", "src/server.js"]

