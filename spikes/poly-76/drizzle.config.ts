import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema',
  out: './drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
