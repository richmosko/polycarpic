FROM postgres:17.12@sha256:b60e90042aa6b8dbecd58e224b3e36114dbf8ad754465264c2476ad58a86e45c
# The server packages are held on the minor the tag names: without the hold the upgrade moves them to whatever pgdg
# ships that day (POLY-138 M5). The rest of the upgrade still lands, so OS fixes arrive on the weekly rebuild.
RUN apt-mark hold "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR" && apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age=1.2.1-1+b5 && rm -rf /var/lib/apt/lists/* /usr/local/bin/gosu
# gosu (removed in the RUN above) is only reached when the entrypoint runs as root; every compose service sets user 999:999 (the lint requires an
# explicit non-root user), and the binary's bundled Go stdlib carries fixable CVEs. Removed rather than ignored.
