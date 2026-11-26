# POLY-97 R3: the dry-run box. Real users, ownership, modes, ACLs, file generation, sshd -T and shellcheck; the volume,
# packages, services and Docker are faked (tests/infra/provision/fakes). Never holds a credential, never reaches a provider.
FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server sudo gawk acl age git shellcheck cloud-init python3 python3-yaml jq postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && userdel -r ubuntu \
 && ssh-keygen -A && mkdir -p /run/sshd
COPY apply-cloud-init.py prelude.sh /harness/
