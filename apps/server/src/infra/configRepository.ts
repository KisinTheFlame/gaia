import { desc, eq, ilike, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { configs } from "./schema.js";

export interface ConfigRepository {
  waitUntilReady(retries: number, retryDelayMs: number): Promise<void>;
  close(): Promise<void>;
  getConfig(key: string): Promise<string | null>;
  listConfigs(input: ListConfigsQuery): Promise<ListConfigsPage>;
  setConfig(key: string, value: string): Promise<void>;
  deleteConfig(key: string): Promise<string | null>;
}

export interface ListConfigsQuery {
  query: string;
  page: number;
  pageSize: number;
}

export interface StoredConfigListItem {
  key: string;
  value: string;
  updatedAt: Date;
}

export interface ListConfigsPage {
  items: StoredConfigListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PgConfigConnection {
  connectionString: string;
}

export class PgConfigRepository implements ConfigRepository {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase;

  constructor(connection: PgConfigConnection) {
    this.pool = new Pool({
      connectionString: connection.connectionString,
    });
    this.db = drizzle(this.pool);
  }

  async waitUntilReady(retries: number, retryDelayMs: number): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await this.db.execute(sql`SELECT 1`);
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

  async listConfigs(input: ListConfigsQuery): Promise<ListConfigsPage> {
    const offset = (input.page - 1) * input.pageSize;
    const filter = input.query.length > 0 ? ilike(configs.key, `%${input.query}%`) : undefined;

    const [items, totalRows] = await Promise.all([
      this.db
        .select({
          key: configs.key,
          value: configs.value,
          updatedAt: configs.updatedAt,
        })
        .from(configs)
        .where(filter)
        .orderBy(desc(configs.updatedAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(configs)
        .where(filter),
    ]);

    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total: totalRows[0]?.count ?? 0,
    };
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
