FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ frontend/
COPY scripts/clean-frontend.mjs scripts/clean-frontend.mjs
RUN cd frontend && npm run build

FROM golang:1.26-bookworm AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /src/backend/internal/webui/dist/ internal/webui/dist/
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /castorice ./cmd/castorice

FROM debian:13-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox ca-certificates fonts-noto-cjk && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app && mkdir /data && chown app:app /data
COPY --from=backend /castorice /usr/local/bin/castorice
ENV CHROME_DEVEL_SANDBOX=/usr/lib/chromium/chrome-sandbox
USER app
EXPOSE 19110
VOLUME /data
ENTRYPOINT ["castorice", "--server", "--no-open", "--listen", "0.0.0.0:19110", "--data-dir", "/data"]
CMD ["--public-url", "http://127.0.0.1:19110"]
