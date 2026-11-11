FROM caddy:2.11.9@sha256:0c2243efcf437ab7f7a978f1027fcf0d4f9be8a75df27b1b3fbc5dbe0ffa8cf0
COPY Caddyfile /etc/caddy/Caddyfile
# A locked placeholder account (random password nobody holds) so the Caddyfile adapts without the secret. Compose
# mounts the real staging_basic_auth file over it; if that mount is missing, compose refuses to start.
RUN mkdir -p /run/secrets \
 && echo "locked $(caddy hash-password --plaintext "$(head -c 32 /dev/urandom | base64)")" > /run/secrets/staging_basic_auth
