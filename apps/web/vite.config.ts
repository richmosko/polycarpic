import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The sign-in service owns /api/auth/* (POLY-152 R1.7): dev and preview proxy it; in production Caddy routes it.
// POLY-150 R8: the proxy plays Caddy: it sets the client address to the browser socket's and overwrites any x-forwarded-for the browser sent.
const authProxy = {
  '/api/auth': {
    target: `http://127.0.0.1:${process.env.AUTH_PUBLIC_PORT ?? 3000}`,
    changeOrigin: false,
    configure: (proxy: { on(ev: 'proxyReq', fn: (req: { setHeader(k: string, v: string): void }, incoming: { socket: { remoteAddress?: string } }) => void): void }) => {
      proxy.on('proxyReq', (req, incoming) => req.setHeader('x-forwarded-for', (incoming.socket.remoteAddress ?? '').replace(/^::ffff:/, '')));
    },
  },
};

// Kit 3 takes its configuration here; there is no svelte.config.js.
// kit.csp is SECURITY C-07's home.
export default defineConfig({
  server: { proxy: authProxy },
  preview: { proxy: authProxy },
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'form-action': ['self'],
          'frame-ancestors': ['none'],
        },
      },
    }),
  ],
});
