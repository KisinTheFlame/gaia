import { Pool } from "pg";

export interface ConfigRepository {
  ensureSchema(retries: number, retryDelayMs: number): Promise<void>;
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;
  deleteConfig(key: string): Promise<string | null>;
}

export interface PgConfigConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export class PgConfigRepository implements ConfigRepository {
  private readonly pool: Pool;

  constructor(connection: PgConfigConnection) {
    this.pool = new Pool(connection);
  }

  async ensureSchema(retries: number, retryDelayMs: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS configs (
            config_key TEXT PRIMARY KEY,
            config_value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        return;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        console.warn(`数据库未就绪，${attempt}/${retries} 次重试失败，${retryDelayMs}ms 后重试`);
        await sleep(retryDelayMs);
      }
    }
  }

  async getConfig(key: string): Promise<string | null> {
    const result = await this.pool.query<{ config_value: string }>(
      "SELECT config_value FROM configs WHERE config_key = $1",
      [key],
    );
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0]?.config_value ?? null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO configs (config_key, config_value)
       VALUES ($1, $2)
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [key, value],
    );
  }

  async deleteConfig(key: string): Promise<string | null> {
    const result = await this.pool.query<{ config_value: string }>(
      "DELETE FROM configs WHERE config_key = $1 RETURNING config_value",
      [key],
    );
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0]?.config_value ?? null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
