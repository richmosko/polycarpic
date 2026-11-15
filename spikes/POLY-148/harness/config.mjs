// Ports, names and paths shared by bin/up, bin/down and the two servers (README contract in checks/README.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(SPIKE, '..', '..');
export const RUN = path.join(SPIKE, '.run');
export const PORTS = { caddy: 58480, caddySw: 58490, web: 58481, service: 58482, pg: 58486, idp: 58488, mail: 58489 };
export const ORIGIN = `http://127.0.0.1:${PORTS.caddy}`;
export const PG = { container: 'poly148-pg', db: 'poly148' };
export const CADDY = { container: 'poly148-caddy', containerSw: 'poly148-caddy-sw', image: 'polycarpic-caddy:ci' };
export const SECRET = 'poly148-auth-secret-0123456789abcdefghijklmnop';
export const HANDLE_COOKIE = process.env.POLY148_HANDLE_COOKIE ?? '__Host-poly_handle';
export const rolePassword = (role) => `qa-${role}`;
