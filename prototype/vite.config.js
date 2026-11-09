import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const brand = fileURLToPath(new URL('../docs/DESIGN/brand/', import.meta.url));

// Serves /brand/* straight from docs/DESIGN/brand (the images the auth and home screens use).
const serveBrand = {
  name: 'serve-design-brand',
  configureServer(server) {
    server.middlewares.use('/brand', (req, res, next) => {
      const f = brand + decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
      if (!f.startsWith(brand) || !existsSync(f)) return next();
      res.setHeader('Content-Type', f.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg');
      createReadStream(f).pipe(res);
    });
  }
};

export default defineConfig({
  plugins: [serveBrand, sveltekit()],
  // tokens.css / screen.css live in ../docs/DESIGN, outside this app's root.
  server: { fs: { allow: ['..'] } }
});
