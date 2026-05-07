# ── Stage 1: Build React frontend ─────────────────────────────────────────
FROM node:26-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python backend + embedded frontend ───────────────────────────
FROM python:3.14-slim

ARG BUILD_CHANNEL
ENV BUILD_CHANNEL=${BUILD_CHANNEL}

ARG GIT_SHA=unknown
ENV BUILD_SHA=${GIT_SHA}

RUN pip install --no-cache-dir --upgrade pip

WORKDIR /app

# Backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Backend source
COPY backend/ .

# VERSION file
COPY VERSION /app/VERSION

# Frontend build output
COPY --from=frontend-build /app/frontend/dist /app/static

EXPOSE 8484

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8484/api/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8484"]
