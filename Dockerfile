# Builds RYDN (ultra-analytics) from the monorepo root.
# Connect GitHub → Deploy. No Root Directory setting required.

FROM node:22-bookworm-slim AS frontend
WORKDIR /fe
COPY ultra-analytics/frontend/package.json ultra-analytics/frontend/package-lock.json ./
RUN npm ci
COPY ultra-analytics/frontend/ ./
ARG VITE_API_BASE=
ARG VITE_PUBLIC_URL=https://rydn.bike
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_PUBLIC_URL=$VITE_PUBLIC_URL \
    VITE_MARKETING_URL=$VITE_PUBLIC_URL
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ULTRA_ENV=production \
    ULTRA_DATA_DIR=/data \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY ultra-analytics/backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY ultra-analytics/backend/ ./backend/
COPY --from=frontend /fe/dist ./frontend/dist

RUN mkdir -p /data
WORKDIR /app/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
