// @poly/config (L0): operator configuration, read once at process start (POLY-85 ruling R1). The user-credential vault is
// packages/secrets and is not this. The logger is the separate subpath @poly/config/log so that nothing below L0
// can reach the secret loader by accident.
export { checkConfig, loadConfig, ConfigError, FAULTS, type Config, type Env, type Fault, type Problem } from './check.ts';
export { Secret } from './secret.ts';
export { REGISTRY, SECRET_NAME_ALLOW, SECRET_NAME_RE, SERVICES, type Service } from './registry.ts';
export const name = '@poly/config';
