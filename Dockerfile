# Source-repository image: compile the server in a dedicated build stage.
FROM rust:1.85-bookworm AS builder

WORKDIR /build
COPY . .
RUN cargo build --locked --release -p server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin proxy

WORKDIR /app
COPY --from=builder /build/target/release/server /app/server
COPY server/config/server.toml /app/server.toml
RUN chown -R proxy:proxy /app

USER proxy
EXPOSE 1080
ENV RUST_LOG=info
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD nc -z 127.0.0.1 1080 || exit 1
CMD ["/app/server", "--config", "/app/server.toml"]
