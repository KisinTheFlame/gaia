import {
  ConfigResponseSchema,
  DeleteConfigResponseSchema,
  ErrorResponseSchema,
  ListConfigsQuerySchema,
  ListConfigsResponseSchema,
  type ConfigResponse,
  type DeleteConfigResponse,
  type ListConfigsQuery,
  type ListConfigsResponse,
  type SetConfigRequest,
} from "@kisintheflame/gaia-shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    throw new ApiError(parsedError.success ? parsedError.data.error : "请求失败", response.status);
  }

  return parse(payload);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function listConfigs(input: Partial<ListConfigsQuery>): Promise<ListConfigsResponse> {
  const query = ListConfigsQuerySchema.parse(input);
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });

  if (query.query.length > 0) {
    params.set("query", query.query);
  }

  return requestJson(`/configs?${params.toString()}`, { method: "GET" }, (payload) =>
    ListConfigsResponseSchema.parse(payload),
  );
}

export async function getConfig(key: string): Promise<ConfigResponse> {
  const params = new URLSearchParams({ key });
  return requestJson(`/get?${params.toString()}`, { method: "GET" }, (payload) =>
    ConfigResponseSchema.parse(payload),
  );
}

export async function setConfig(input: SetConfigRequest): Promise<ConfigResponse> {
  return requestJson(
    "/set",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    (payload) => ConfigResponseSchema.parse(payload),
  );
}

export async function deleteConfig(key: string): Promise<DeleteConfigResponse> {
  const params = new URLSearchParams({ key });
  return requestJson(`/delete?${params.toString()}`, { method: "DELETE" }, (payload) =>
    DeleteConfigResponseSchema.parse(payload),
  );
}
