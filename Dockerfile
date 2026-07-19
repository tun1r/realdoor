FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend ./frontend
RUN npm --prefix frontend run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    REALDOOR_ENABLE_HOSTED_VISION=false \
    REALDOOR_PACK_PATH=/app/backend/realdoor/demo_pack \
    REALDOOR_SESSION_DIR=/tmp/realdoor-sessions \
    REALDOOR_FRONTEND_DIST=/app/frontend/dist

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY scripts ./scripts
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN python scripts/generate_deploy_demo_pack.py

EXPOSE 8000
CMD ["sh", "-c", "uvicorn realdoor.api:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
