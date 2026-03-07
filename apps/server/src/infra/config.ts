export interface AppConfig {
  port: number;
  databaseUrl: string;
  dbInitRetries: number;
  dbInitRetryDelayMs: number;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("缺少必需环境变量 DATABASE_URL");
  }

  return {
    port: Number(env.PORT ?? 20005),
    databaseUrl,
    dbInitRetries: Number(env.DB_INIT_RETRIES ?? 30),
    dbInitRetryDelayMs: Number(env.DB_INIT_RETRY_DELAY_MS ?? 1000),
  };
}
