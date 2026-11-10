import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './migrations',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
