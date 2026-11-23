# The uploader's image (POLY-99 R4): rclone at the version the upload argv was measured with, plus curl and the CA bundle.
# Build context is infra/backup/. The rclone release zip is checked against a SHA-256 pinned here, per architecture.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS fetch
ARG TARGETARCH
ARG RCLONE_VERSION=v1.76.0
ARG RCLONE_SHA256_AMD64=b00f00b3266c3764413afe599d3ec316f6f43b3e0ea8a0bc1d186d2133e46df7
ARG RCLONE_SHA256_ARM64=ee169016675e23a69d77240565133ff7dbc9b33d16fa8f7053d4af39f1eaeb78
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) want="$RCLONE_SHA256_AMD64" ;; \
      arm64) want="$RCLONE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    curl -fsSL -o /rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${arch}.zip"; \
    echo "$want  /rclone.zip" | sha256sum -c -; \
    unzip -j /rclone.zip "rclone-${RCLONE_VERSION}-linux-${arch}/rclone" -d /out

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /out/rclone /usr/local/bin/rclone
