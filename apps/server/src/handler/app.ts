import {
  ConfigChangeEventSchema,
  ConfigResponseSchema,
  DeleteConfigQuerySchema,
  DeleteConfigResponseSchema,
  ErrorResponseSchema,
  GetConfigQuerySchema,
  ListConfigsQuerySchema,
  ListConfigsResponseSchema,
  SetConfigRequestSchema,
  SubscribeConfigsQuerySchema,
} from "@kisinwen/gaia-shared";
import Fastify, { type FastifyReply } from "fastify";
import { z } from "zod";

import type { ConfigService } from "../service/configService.js";
import { ConfigChangeBroker } from "./configChangeBroker.js";

const SSE_KEEPALIVE_MS = 15_000;

export function createApp(
  configService: ConfigService,
  broker: ConfigChangeBroker = new ConfigChangeBroker(),
) {
  const app = Fastify();

  app.get("/configs", async (request, reply) => {
    const queryResult = ListConfigsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, { error: "分页参数不合法" });
      return;
    }

    try {
      const result = await configService.listConfigs(queryResult.data);
      sendValidatedJson(reply, 200, ListConfigsResponseSchema, result);
    } catch (error) {
      request.log.error({ error }, "读取配置列表失败");
      sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "读取配置列表失败" });
    }
  });

  app.get("/get", async (request, reply) => {
    const queryResult = GetConfigQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, { error: "缺少查询参数 key" });
      return;
    }

    try {
      const record = await configService.getConfig(queryResult.data.key);
      if (record === null) {
        sendValidatedJson(reply, 404, ErrorResponseSchema, {
          error: "配置不存在",
          key: queryResult.data.key,
        });
        return;
      }

      sendValidatedJson(reply, 200, ConfigResponseSchema, record);
    } catch (error) {
      request.log.error({ error }, "读取配置失败");
      sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "读取配置失败" });
    }
  });

  app.post<{ Body: unknown }>("/set", async (request, reply) => {
    const bodyResult = SetConfigRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, {
        error: "请求体必须包含非空 key 与字符串 value",
      });
      return;
    }

    try {
      const saved = await configService.setConfig(bodyResult.data.key, bodyResult.data.value);
      sendValidatedJson(reply, 200, ConfigResponseSchema, saved);
      broker.publish({
        type: "upsert",
        key: saved.key,
        value: saved.value,
        changedAt: saved.updatedAt,
      });
    } catch (error) {
      request.log.error({ error }, "写入配置失败");
      sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "写入配置失败" });
    }
  });

  app.delete("/delete", async (request, reply) => {
    const queryResult = DeleteConfigQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, { error: "缺少查询参数 key" });
      return;
    }

    try {
      const deleted = await configService.deleteConfig(queryResult.data.key);
      if (deleted === null) {
        sendValidatedJson(reply, 404, ErrorResponseSchema, {
          error: "配置不存在",
          key: queryResult.data.key,
        });
        return;
      }

      const changedAt = new Date().toISOString();
      sendValidatedJson(reply, 200, DeleteConfigResponseSchema, {
        key: deleted.key,
        value: deleted.value,
        deleted: true,
        changedAt,
      });
      broker.publish({
        type: "delete",
        key: deleted.key,
        changedAt,
      });
    } catch (error) {
      request.log.error({ error }, "删除配置失败");
      sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "删除配置失败" });
    }
  });

  app.get("/subscribe", async (request, reply) => {
    const queryResult = SubscribeConfigsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, { error: "至少订阅一个 key" });
      return;
    }

    reply.hijack();

    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    raw.setHeader("Cache-Control", "no-cache, no-transform");
    raw.setHeader("Connection", "keep-alive");
    raw.setHeader("X-Accel-Buffering", "no");
    raw.flushHeaders?.();
    raw.write(": connected\n\n");

    const unsubscribe = broker.subscribe(queryResult.data.key, (event) => {
      sendSseEvent(raw, event);
    });
    const keepalive = setInterval(() => {
      raw.write(": ping\n\n");
    }, SSE_KEEPALIVE_MS);
    keepalive.unref?.();

    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) {
        return;
      }

      isCleanedUp = true;
      clearInterval(keepalive);
      unsubscribe();
    };

    request.raw.once("close", cleanup);
    raw.once("close", cleanup);
    raw.once("finish", cleanup);
    raw.once("error", cleanup);
  });

  app.setNotFoundHandler((_request, reply) => {
    sendValidatedJson(reply, 404, ErrorResponseSchema, { error: "Not Found" });
  });

  app.setErrorHandler((error, request, reply) => {
    if (isInvalidJsonBodyError(error)) {
      sendValidatedJson(reply, 400, ErrorResponseSchema, { error: "请求体不是合法 JSON" });
      return;
    }

    request.log.error({ error }, "未处理异常");
    sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "Internal Server Error" });
  });

  return app;
}

function sendValidatedJson<T extends z.ZodTypeAny>(
  reply: FastifyReply,
  statusCode: number,
  schema: T,
  body: z.input<T>,
): void {
  const payload = schema.parse(body);
  void reply.status(statusCode).send(payload);
}

function sendSseEvent(reply: NodeJS.WritableStream, event: z.input<typeof ConfigChangeEventSchema>): void {
  const payload = ConfigChangeEventSchema.parse(event);
  reply.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isInvalidJsonBodyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
