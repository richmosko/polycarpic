# POLY-99 qa harness tools: ACLs (setfacl/getfacl), inotifywait for the spool watcher, age. Never holds a credential.
FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends acl inotify-tools age ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY watcher.sh /harness/watcher.sh
RUN chmod 0755 /harness/watcher.sh
