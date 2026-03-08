import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ConfigChangeEventSchema,
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

type CacheEntry =
  | {
      status: "present";
      value: string;
      lastChangedAt: string;
    }
  | {
      status: "missing";
      lastChangedAt: string;
    };

type ConnectionState = "idle" | "connecting" | "open";

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

const cache = new Map<string, CacheEntry>();
const watchedKeys = new Set<string>();
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

let initializedBaseUrl: string | null = null;
let sseController: AbortController | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let activeConnectionPromise: Promise<void> | null = null;
let connectionState: ConnectionState = "idle";
let reconnectAttempt = 0;
let connectionVersion = 0;

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

  let normalizedBaseUrl: string;
  try {
    const parsed = GaiaClientConfigSchema.parse({ baseUrl: configBaseUrl });
    normalizedBaseUrl = normalizeBaseUrl(parsed.baseUrl);
  } catch (error) {
    throw new GaiaClientError("VALIDATION_FAILED", "初始化参数中的 baseUrl 非法", {
      details: error,
    });
  }

  await resetClientState({ clearInitialization: false });
  initializedBaseUrl = normalizedBaseUrl;
}

export async function closeGaiaClient(): Promise<void> {
  await resetClientState({ clearInitialization: true });
}

export async function getConfig(key: string): Promise<z.infer<typeof ConfigResponseSchema>> {
  ensureInitialized();
  const query = GetConfigQuerySchema.parse({ key });
  const cached = cache.get(query.key);
  if (cached) {
    return buildCachedConfigResponse(query.key, cached);
  }

  let shouldWatch = false;

  try {
    const payload = await requestJson(buildUrl(`/get?key=${encodeURIComponent(query.key)}`));
    const config = ConfigResponseSchema.parse(payload);
    setPresentCache(config.key, config.value, config.updatedAt);
    shouldWatch = true;
    return config;
  } catch (error) {
    if (isConfigNotFoundError(error)) {
      setMissingCache(query.key, new Date().toISOString());
      shouldWatch = true;
    }
    throw error;
  } finally {
    if (shouldWatch) {
      trackWatchedKey(query.key);
    }
  }
}

export async function setConfig(
  key: string,
  value: string,
): Promise<z.infer<typeof ConfigResponseSchema>> {
  ensureInitialized();
  const body = SetConfigRequestSchema.parse({ key, value });
  const payload = await requestJson(buildUrl("/set"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const saved = ConfigResponseSchema.parse(payload);
  setPresentCache(saved.key, saved.value, saved.updatedAt);
  trackWatchedKey(saved.key);
  return saved;
}

export async function deleteConfig(
  key: string,
): Promise<z.infer<typeof DeleteConfigResponseSchema>> {
  ensureInitialized();
  const query = DeleteConfigQuerySchema.parse({ key });
  const payload = await requestJson(buildUrl(`/delete?key=${encodeURIComponent(query.key)}`), {
    method: "DELETE",
  });
  const deleted = DeleteConfigResponseSchema.parse(payload);
  setMissingCache(deleted.key, deleted.changedAt);
  trackWatchedKey(deleted.key);
  return deleted;
}

function ensureInitialized(): void {
  if (!initializedBaseUrl) {
    throw new GaiaClientError(
      "CONFIG_NOT_INITIALIZED",
      "请先调用 initializeGaiaClient() 完成初始化",
    );
  }
}

function buildCachedConfigResponse(
  key: string,
  entry: CacheEntry,
): z.infer<typeof ConfigResponseSchema> {
  if (entry.status === "missing") {
    throw createConfigNotFoundError(key);
  }

  return {
    key,
    value: entry.value,
    updatedAt: entry.lastChangedAt,
  };
}

function createConfigNotFoundError(key: string): GaiaClientError {
  return new GaiaClientError("HTTP_ERROR", "配置不存在", {
    status: 404,
    details: {
      error: "配置不存在",
      key,
    },
  });
}

function isConfigNotFoundError(error: unknown): error is GaiaClientError {
  return error instanceof GaiaClientError && error.code === "HTTP_ERROR" && error.status === 404;
}

function setPresentCache(key: string, value: string, changedAt: string): void {
  cache.set(key, {
    status: "present",
    value,
    lastChangedAt: changedAt,
  });
}

function setMissingCache(key: string, changedAt: string): void {
  cache.set(key, {
    status: "missing",
    lastChangedAt: changedAt,
  });
}

function trackWatchedKey(key: string): void {
  const hasAdded = !watchedKeys.has(key);
  watchedKeys.add(key);

  if (hasAdded) {
    restartSseConnection();
    return;
  }

  ensureSseConnection();
}

function restartSseConnection(): void {
  connectionVersion += 1;
  clearReconnectTimer();
  if (sseController) {
    sseController.abort();
    sseController = null;
  }
  connectionState = "idle";

  if (!initializedBaseUrl || watchedKeys.size === 0) {
    activeConnectionPromise = null;
    return;
  }

  scheduleSseConnection(0, connectionVersion);
}

function ensureSseConnection(): void {
  if (!initializedBaseUrl || watchedKeys.size === 0) {
    return;
  }

  if (sseController || reconnectTimer || activeConnectionPromise || connectionState === "connecting") {
    return;
  }

  scheduleSseConnection(0, connectionVersion);
}

function scheduleSseConnection(delayMs: number, version: number): void {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const promise = startSseConnection(version);
    activeConnectionPromise = promise;
    void promise.finally(() => {
      if (activeConnectionPromise === promise) {
        activeConnectionPromise = null;
      }
    });
  }, delayMs);
}

async function startSseConnection(version: number): Promise<void> {
  if (version !== connectionVersion || !initializedBaseUrl || watchedKeys.size === 0) {
    return;
  }

  const controller = new AbortController();
  sseController = controller;
  connectionState = "connecting";

  try {
    const response = await fetch(buildSubscribeUrl(getSortedWatchedKeys()), {
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GaiaClientError("NETWORK_ERROR", "订阅配置变更失败", {
        status: response.status,
        details: await safeReadResponsePayload(response),
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw new GaiaClientError("NETWORK_ERROR", "订阅配置变更失败，响应类型不是 SSE", {
        details: {
          contentType,
        },
      });
    }

    if (!response.body) {
      throw new GaiaClientError("NETWORK_ERROR", "订阅配置变更失败，响应缺少流数据");
    }

    connectionState = "open";
    reconnectAttempt = 0;
    await consumeEventStream(response.body, controller.signal);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
  } finally {
    if (sseController === controller) {
      sseController = null;
    }
    connectionState = "idle";

    if (version !== connectionVersion || !initializedBaseUrl || watchedKeys.size === 0) {
      return;
    }

    const delayMs = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    scheduleSseConnection(delayMs, version);
  }
}

async function consumeEventStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) {
        throw createAbortError();
      }

      const result = await reader.read();
      if (result.done) {
        return;
      }

      buffer += decoder.decode(result.value, { stream: true });
      buffer = processSseBuffer(buffer);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function processSseBuffer(buffer: string): string {
  let nextBuffer = buffer;

  while (true) {
    const separatorIndex = nextBuffer.indexOf("\n\n");
    if (separatorIndex === -1) {
      return nextBuffer;
    }

    const rawEvent = nextBuffer.slice(0, separatorIndex);
    nextBuffer = nextBuffer.slice(separatorIndex + 2);
    handleSseEvent(rawEvent);
  }
}

function handleSseEvent(rawEvent: string): void {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return;
  }

  try {
    const parsed = ConfigChangeEventSchema.parse(JSON.parse(dataLines.join("\n")));
    if (parsed.type === "upsert") {
      setPresentCache(parsed.key, parsed.value, parsed.changedAt);
      return;
    }

    setMissingCache(parsed.key, parsed.changedAt);
  } catch {
    // Ignore malformed events so one bad payload does not break the stream consumer.
  }
}

async function resetClientState(options: { clearInitialization: boolean }): Promise<void> {
  connectionVersion += 1;
  clearReconnectTimer();

  const runningConnection = activeConnectionPromise;
  activeConnectionPromise = null;

  if (sseController) {
    sseController.abort();
    sseController = null;
  }

  connectionState = "idle";
  reconnectAttempt = 0;

  if (runningConnection) {
    await runningConnection.catch(() => undefined);
  }

  cache.clear();
  watchedKeys.clear();

  if (options.clearInitialization) {
    initializedBaseUrl = null;
  }
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function getSortedWatchedKeys(): string[] {
  return [...watchedKeys].sort((left, right) => left.localeCompare(right));
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildUrl(pathname: string): string {
  ensureInitialized();
  return `${initializedBaseUrl!}${pathname}`;
}

function buildSubscribeUrl(keys: string[]): string {
  const searchParams = new URLSearchParams();
  for (const key of keys) {
    searchParams.append("key", key);
  }

  return buildUrl(`/subscribe?${searchParams.toString()}`);
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

async function safeReadResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
