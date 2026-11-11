# The one app image: web, worker and migrate are entrypoints of it (ARCH 8.1, POLY-85 ruling R5).
#   docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t polycarpic .
# The final stage carries the source commit as org.opencontainers.image.revision, the label POLY-100's tag-to-digest check
# reads. The build fails unless GIT_COMMIT is a full 40-hex sha. No secret enters the image: not as a build arg, not as ENV.

# --- build: install the production dependencies of the whole workspace -------------------------------------------------
FROM node:26.12.0-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11 AS build
WORKDIR /app
# Node 26 ships no package-manager shim; --allow-scripts=pnpm lets the pnpm binary land
RUN npm i -g --allow-scripts=pnpm pnpm@12.18.0
COPY . .
# packages/db/migrations (with meta/_journal.json, which POLY-100 reads) travels in this copy
# Workspace links, not `pnpm deploy`: Node will not strip types from files under node_modules, and a workspace symlink
# resolves to packages/*/src outside it. Dev dependencies stay out.
RUN pnpm install --frozen-lockfile --prod

# --- runtime ------------------------------------------------------------------------------------------------------------
FROM node:26.12.0-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11
ARG GIT_COMMIT
RUN echo "$GIT_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
# POLY-96 (C-82): fixable HIGH findings fail the build. Debian security fixes land between base-image digests, so
# upgrade in place; and drop the node package manager tree, which the entrypoint never uses and which ships its own
# vulnerable copies of brace-expansion and undici.
RUN apt-get update \
 && apt-get -y --no-install-recommends upgrade \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules \
 && find /usr/local/bin -xtype l -delete
LABEL org.opencontainers.image.revision=$GIT_COMMIT \
      org.opencontainers.image.source=https://github.com/richmosko/polycarpic
ENV POLY_IMAGE_REVISION=$GIT_COMMIT NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /app /app
USER node
ENTRYPOINT ["/app/bin/polycarpic"]
CMD ["web"]
