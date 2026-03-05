import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ConfigResponseSchema,
  DeleteConfigQuerySchema,
  DeleteConfigResponseSchema,
  ErrorResponseSchema,
  GaiaClientConfigSchema,
  GetConfigQuerySchema,
  SetConfigRequestSchema,
} from "@kisintheflame/gaia-shared";
import YAML from "yaml";
import { z } from "zod";

const InitOptionsSchema = z
  .object({
    configPath: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
  })
  .optional();

type InitOptions = z.infer<typeof InitOptionsSchema>;

export type GaiaClientErrorCode =
  | "CONFIG_NOT_INITIALIZED"
  | "CONFIG_FILE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR";

export class GaiaClientError extends Error {
  readonly code: GaiaClientErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    code: GaiaClientErrorCode,
    message: string,
    options?: { status?: number; details?: unknown },
  ) {
    super(message);
    this.name = "GaiaClientError";
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }
}

let initializedBaseUrl: string | null = null;

export async function initializeGaiaClient(options?: InitOptions): Promise<void> {
  const parsedOptions = InitOptionsSchema.parse(options);

  const configPath = parsedOptions?.configPath ?? path.resolve(process.cwd(), "gaia.config.yml");

  let configBaseUrl: string | undefined;
  if (parsedOptions?.baseUrl) {
    configBaseUrl = parsedOptions.baseUrl;
  } else {
    let fileContent: string;
    try {
      fileContent = await readFile(configPath, "utf8");
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";

      if (isMissing) {
        throw new GaiaClientError("CONFIG_FILE_NOT_FOUND", `未找到配置文件: ${configPath}`);
      }
      throw new GaiaClientError("NETWORK_ERROR", `读取配置文件失败: ${configPath}`, {
        details: error,
      });
    }

    let parsedYaml: unknown;
    try {
      parsedYaml = YAML.parse(fileContent);
    } catch (error) {
      throw new GaiaClientError("VALIDATION_FAILED", "gaia.config.yml 解析失败", {
        details: error,
      });
    }

    try {
      const parsedConfig = GaiaClientConfigSchema.parse(parsedYaml);
      configBaseUrl = parsedConfig.baseUrl;
    } catch (error) {
      throw new GaiaClientError(
        "VALIDATION_FAILED",
        "gaia.config.yml 校验失败，必须包含合法的 baseUrl",
        {
          details: error,
        },
      );
    }
  }

  try {
    const parsed = GaiaClientConfigSchema.parse({ baseUrl: configBaseUrl });
    initializedBaseUrl = normalizeBaseUrl(parsed.baseUrl);
  } catch (error) {
    throw new GaiaClientError("VALIDATION_FAILED", "初始化参数中的 baseUrl 非法", {
      details: error,
    });
  }
}

export async function getConfig(key: string): Promise<z.infer<typeof ConfigResponseSchema>> {
  ensureInitialized();
  const query = GetConfigQuerySchema.parse({ key });
  const url = buildUrl(`/get?key=${encodeURIComponent(query.key)}`);
  const payload = await requestJson(url);
  return ConfigResponseSchema.parse(payload);
}

export async function setConfig(
  key: string,
  value: string,
): Promise<z.infer<typeof ConfigResponseSchema>> {
  ensureInitialized();
  const body = SetConfigRequestSchema.parse({ key, value });
  const url = buildUrl("/set");
  const payload = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return ConfigResponseSchema.parse(payload);
}

export async function deleteConfig(
  key: string,
): Promise<z.infer<typeof DeleteConfigResponseSchema>> {
  const query = DeleteConfigQuerySchema.parse({ key });
  const url = buildUrl(`/delete?key=${encodeURIComponent(query.key)}`);
  const payload = await requestJson(url, {
    method: "DELETE",
  });
  return DeleteConfigResponseSchema.parse(payload);
}

function ensureInitialized(): void {
  if (!initializedBaseUrl) {
    throw new GaiaClientError(
      "CONFIG_NOT_INITIALIZED",
      "请先调用 initializeGaiaClient() 完成初始化",
    );
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildUrl(pathname: string): string {
  ensureInitialized();
  return `${initializedBaseUrl!}${pathname}`;
}

async function requestJson(input: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new GaiaClientError("NETWORK_ERROR", "请求 Gaia 服务失败", { details: error });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GaiaClientError("VALIDATION_FAILED", "响应不是合法 JSON", {
      status: response.status,
      details: error,
    });
  }

  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    const message = parsedError.success ? parsedError.data.error : `HTTP ${response.status}`;
    throw new GaiaClientError("HTTP_ERROR", message, {
      status: response.status,
      details: parsedError.success ? parsedError.data : payload,
    });
  }

  return payload;
}
