export interface AppConfig {
  port: number;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbInitRetries: number;
  dbInitRetryDelayMs: number;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    dbHost: env.DB_HOST ?? "localhost",
    dbPort: Number(env.DB_PORT ?? 5432),
    dbName: env.DB_NAME ?? "gaia",
    dbUser: env.DB_USER ?? "gaia",
    dbPassword: env.DB_PASSWORD ?? "gaia",
    dbInitRetries: Number(env.DB_INIT_RETRIES ?? 30),
    dbInitRetryDelayMs: Number(env.DB_INIT_RETRY_DELAY_MS ?? 1000),
  };
}
