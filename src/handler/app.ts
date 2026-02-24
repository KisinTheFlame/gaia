import express, { type NextFunction, type Request, type Response } from "express";

import type { ConfigService } from "../service/configService.js";

export function createApp(configService: ConfigService) {
  const app = express();

  app.use(express.json());

  app.get("/get", async (req: Request, res: Response) => {
    const key = parseQueryKey(req.query.key);
    if (!key) {
      sendJson(res, 400, { error: "缺少查询参数 key" });
      return;
    }

    try {
      const value = await configService.getConfig(key);
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
      await configService.setConfig(key, value);
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
      const value = await configService.deleteConfig(key);
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

  app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    void next;
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "请求体不是合法 JSON" });
      return;
    }
    console.error("未处理异常:", error);
    sendJson(res, 500, { error: "Internal Server Error" });
  });

  return app;
}

function sendJson(res: Response, statusCode: number, body: Record<string, unknown>): void {
  res.status(statusCode).json(body);
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

function parseQueryKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmedKey = raw.trim();
  return trimmedKey === "" ? undefined : trimmedKey;
}
