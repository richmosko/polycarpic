ARG PG_BASE
FROM ${PG_BASE}
RUN apt-mark hold "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR" && apt-get update && apt-get install -y --no-install-recommends postgresql-17-pgtap && rm -rf /var/lib/apt/lists/*
