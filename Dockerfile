# Frontend (Vite) + backend (Flask/gunicorn) для Railway.
# Кастомный buildCommand у Railpack не ставит Python; образ собираем явно.

FROM node:22-bookworm-slim AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

COPY server/requirements.txt ./server/
RUN python -m pip install --upgrade pip && \
    python -m pip install -r server/requirements.txt

COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

EXPOSE 8080
CMD cd server && exec gunicorn -w 1 -b 0.0.0.0:${PORT:-8080} app:app
