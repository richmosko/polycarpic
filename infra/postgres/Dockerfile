FROM postgres:17.10@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age=1.2.1-1+b5 && rm -rf /var/lib/apt/lists/*
