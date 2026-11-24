// T-real's "web never answers" release (ruling 3765f358): the second candidate's apps/web/src/main.ts is replaced by this. The process stays up, nothing listens, so web's healthcheck fails
// until the rollback window ends. Everything else in that image is the job's own build.
// `web check-config` is the tool's one-off check of the candidate before anything starts: this release's configuration is valid, so that run ends 0 at once (without this the one-off never exits and the poll waits out its whole bound).
if (process.argv[2] === 'check-config') process.exit(0);
setInterval(() => {}, 1 << 30);
