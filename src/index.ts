import express, { type NextFunction, type Request, type Response } from "express";
import { Pool } from "pg";

const port = Number(process.env.PORT ?? 3000);
const dbHost = process.env.DB_HOST ?? "localhost";
const dbPort = Number(process.env.DB_PORT ?? 5432);
const dbName = process.env.DB_NAME ?? "gaia";
const dbUser = process.env.DB_USER ?? "gaia";
const dbPassword = process.env.DB_PASSWORD ?? "gaia";
const dbInitRetries = Number(process.env.DB_INIT_RETRIES ?? 30);
const dbInitRetryDelayMs = Number(process.env.DB_INIT_RETRY_DELAY_MS ?? 1000);

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPassword,
});

function sendJson(res: Response, statusCode: number, body: Record<string, unknown>): void {
  res.status(statusCode).json(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function initDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= dbInitRetries; attempt += 1) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS configs (
          config_key TEXT PRIMARY KEY,
          config_value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      return;
    } catch (error) {
      if (attempt === dbInitRetries) {
        throw error;
      }
      console.warn(
        `数据库未就绪，${attempt}/${dbInitRetries} 次重试失败，${dbInitRetryDelayMs}ms 后重试`,
      );
      await sleep(dbInitRetryDelayMs);
    }
  }
}

function parseKey(body: Record<string, unknown>): string | undefined {
  const key = body.key;
  if (typeof key !== "string") {
    return undefined;
  }
  const trimmedKey = key.trim();
  return trimmedKey === "" ? undefined : trimmedKey;
}

function parseValue(body: Record<string, unknown>): string | undefined {
  const value = body.value;
  return typeof value === "string" ? value : undefined;
}

async function getConfig(key: string): Promise<string | null> {
  const result = await pool.query<{ config_value: string }>(
    "SELECT config_value FROM configs WHERE config_key = $1",
    [key],
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0]?.config_value ?? null;
}

async function setConfig(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO configs (config_key, config_value)
     VALUES ($1, $2)
     ON CONFLICT (config_key)
     DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [key, value],
  );
}

async function deleteConfig(key: string): Promise<string | null> {
  const result = await pool.query<{ config_value: string }>(
    "DELETE FROM configs WHERE config_key = $1 RETURNING config_value",
    [key],
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0]?.config_value ?? null;
}

function parseQueryKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmedKey = raw.trim();
  return trimmedKey === "" ? undefined : trimmedKey;
}

const app = express();
app.use(express.json());

app.get("/get", async (req: Request, res: Response) => {
  const key = parseQueryKey(req.query.key);
  if (!key) {
    sendJson(res, 400, { error: "缺少查询参数 key" });
    return;
  }
  try {
    const value = await getConfig(key);
    if (value === null) {
      sendJson(res, 404, { error: "配置不存在", key });
      return;
    }
    sendJson(res, 200, { key, value });
  } catch (error) {
    console.error("读取配置失败:", error);
    sendJson(res, 500, { error: "读取配置失败" });
  }
});

app.post("/set", async (req: Request, res: Response) => {
  if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
    sendJson(res, 400, { error: "请求体必须是 JSON 对象" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const key = parseKey(body);
  if (!key) {
    sendJson(res, 400, { error: "key 必须是非空字符串" });
    return;
  }
  const value = parseValue(body);
  if (value === undefined) {
    sendJson(res, 400, { error: "value 必须是字符串" });
    return;
  }
  try {
    await setConfig(key, value);
    sendJson(res, 200, { key, value });
  } catch (error) {
    console.error("写入配置失败:", error);
    sendJson(res, 500, { error: "写入配置失败" });
  }
});

app.delete("/delete", async (req: Request, res: Response) => {
  const key = parseQueryKey(req.query.key);
  if (!key) {
    sendJson(res, 400, { error: "缺少查询参数 key" });
    return;
  }
  try {
    const value = await deleteConfig(key);
    if (value === null) {
      sendJson(res, 404, { error: "配置不存在", key });
      return;
    }
    sendJson(res, 200, { key, value, deleted: true });
  } catch (error) {
    console.error("删除配置失败:", error);
    sendJson(res, 500, { error: "删除配置失败" });
  }
});

app.use((_req: Request, res: Response) => {
  sendJson(res, 404, { error: "Not Found" });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  if (error instanceof SyntaxError) {
    sendJson(res, 400, { error: "请求体不是合法 JSON" });
    return;
  }
  console.error("未处理异常:", error);
  sendJson(res, 500, { error: "Internal Server Error" });
});

await initDatabase();

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
  console.log(`Config storage: postgresql://${dbUser}@${dbHost}:${dbPort}/${dbName}`);
});
