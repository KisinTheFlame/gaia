import { defineConfig } from "prisma/config";

function buildDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  const host = env.DB_HOST ?? "localhost";
  const port = env.DB_PORT ?? "5432";
  const database = env.DB_NAME ?? "gaia";
  const user = env.DB_USER ?? "gaia";
  const password = env.DB_PASSWORD ?? "gaia";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: buildDatabaseUrl(),
  },
});
