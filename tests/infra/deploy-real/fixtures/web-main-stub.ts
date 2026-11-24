// T-real's "web never answers" release (ruling 3765f358): the second candidate's apps/web/src/main.ts is replaced by this. The process stays up, nothing listens, so web's healthcheck fails
// until the rollback window ends. Everything else in that image is the job's own build.
setInterval(() => {}, 1 << 30);
