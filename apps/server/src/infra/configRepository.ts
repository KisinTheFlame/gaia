import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { configs } from "./schema.js";

export interface ConfigRepository {
  ensureSchema(retries: number, retryDelayMs: number): Promise<void>;
  close(): Promise<void>;
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
  private readonly db: NodePgDatabase;

  constructor(connection: PgConfigConnection) {
    this.pool = new Pool(connection);
    this.db = drizzle(this.pool);
  }

  async ensureSchema(retries: number, retryDelayMs: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await this.db.execute(sql`
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

  close(): Promise<void> {
    return this.pool.end();
  }

  async getConfig(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: configs.value })
      .from(configs)
      .where(eq(configs.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.db
      .insert(configs)
      .values({ key, value })
      .onConflictDoUpdate({
        target: configs.key,
        set: {
          value,
          updatedAt: sql`NOW()`,
        },
      });
  }

  async deleteConfig(key: string): Promise<string | null> {
    const rows = await this.db
      .delete(configs)
      .where(eq(configs.key, key))
      .returning({ value: configs.value });
    return rows[0]?.value ?? null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
