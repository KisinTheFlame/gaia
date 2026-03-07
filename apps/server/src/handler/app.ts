import {
  ConfigResponseSchema,
  DeleteConfigQuerySchema,
  DeleteConfigResponseSchema,
  ErrorResponseSchema,
  GetConfigQuerySchema,
  ListConfigsQuerySchema,
  ListConfigsResponseSchema,
  SetConfigRequestSchema,
} from "@kisintheflame/gaia-shared";
import Fastify, { type FastifyReply } from "fastify";
import { z } from "zod";

import type { ConfigService } from "../service/configService.js";

export function createApp(configService: ConfigService) {
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
      const value = await configService.getConfig(queryResult.data.key);
      if (value === null) {
        sendValidatedJson(reply, 404, ErrorResponseSchema, {
          error: "配置不存在",
          key: queryResult.data.key,
        });
        return;
      }

      sendValidatedJson(reply, 200, ConfigResponseSchema, {
        key: queryResult.data.key,
        value,
      });
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
      await configService.setConfig(bodyResult.data.key, bodyResult.data.value);
      sendValidatedJson(reply, 200, ConfigResponseSchema, bodyResult.data);
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
      const value = await configService.deleteConfig(queryResult.data.key);
      if (value === null) {
        sendValidatedJson(reply, 404, ErrorResponseSchema, {
          error: "配置不存在",
          key: queryResult.data.key,
        });
        return;
      }

      sendValidatedJson(reply, 200, DeleteConfigResponseSchema, {
        key: queryResult.data.key,
        value,
        deleted: true,
      });
    } catch (error) {
      request.log.error({ error }, "删除配置失败");
      sendValidatedJson(reply, 500, ErrorResponseSchema, { error: "删除配置失败" });
    }
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

function isInvalidJsonBodyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
