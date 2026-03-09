import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import test from "node:test";
import { z } from "zod";

import {
  closeGaiaClient,
  GaiaClientError,
  getConfig,
  initializeGaiaClient,
  listConfigs,
} from "./index.js";

test("getConfig only fetches a key once and then serves the cache", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });

      const first = await getConfig("a");
      const second = await getConfig("a");

      await waitFor(() => server.subscribeRequests.length === 1);

      assert.deepEqual(first, {
        key: "a",
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      });
      assert.deepEqual(second, first);
      assert.equal(server.getCalls.get("a"), 1);
      assert.deepEqual(server.subscribeRequests[0], ["a"]);
    },
  );
});

test("listConfigs sends query and pagination params and validates the response", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      "payment.timeout": {
        value: "3000",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
      "payment.retry": {
        value: "2",
        updatedAt: "2026-03-09T10:01:00.000Z",
      },
      "user.theme": {
        value: "dark",
        updatedAt: "2026-03-09T10:02:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });

      const result = await listConfigs({
        query: "payment",
        page: 2,
        pageSize: 1,
      });

      assert.deepEqual(result, {
        items: [
          {
            key: "payment.timeout",
            valuePreview: "3000",
            updatedAt: "2026-03-09T10:00:00.000Z",
          },
        ],
        page: 2,
        pageSize: 1,
        total: 2,
      });
      assert.deepEqual(server.listCalls[0], {
        query: "payment",
        page: 2,
        pageSize: 1,
      });
    },
  );
});

test("listConfigs wraps invalid JSON responses as validation errors", async () => {
  await runWithRawServer(
    async (_request, response) => {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end("{");
    },
    async (baseUrl) => {
      await initializeGaiaClient({ baseUrl });

      await assert.rejects(
        () => listConfigs(),
        (error: unknown) => {
          assert.ok(error instanceof GaiaClientError);
          assert.equal(error.code, "VALIDATION_FAILED");
          assert.match(error.message, /响应不是合法 JSON/);
          return true;
        },
      );
    },
  );
});

test("listConfigs rejects structurally invalid payloads", async () => {
  await runWithRawServer(
    async (_request, response) => {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          items: "not-an-array",
          page: 1,
          pageSize: 20,
          total: 0,
        }),
      );
    },
    async (baseUrl) => {
      await initializeGaiaClient({ baseUrl });

      await assert.rejects(
        () => listConfigs(),
        (error: unknown) => {
          assert.ok(error instanceof z.ZodError || error instanceof GaiaClientError);
          return true;
        },
      );
    },
  );
});

test("SSE upsert events refresh the cached config", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });
      await getConfig("a");
      await waitFor(() => server.subscribeRequests.length === 1);

      server.emit({
        type: "upsert",
        key: "a",
        value: "v2",
        changedAt: "2026-03-09T10:05:00.000Z",
      });

      await waitFor(async () => (await getConfig("a")).value === "v2");

      assert.deepEqual(await getConfig("a"), {
        key: "a",
        value: "v2",
        updatedAt: "2026-03-09T10:05:00.000Z",
      });
      assert.equal(server.getCalls.get("a"), 1);
    },
  );
});

test("SSE delete events turn cached keys into 404-style misses without refetching", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });
      await getConfig("a");
      await waitFor(() => server.subscribeRequests.length === 1);

      server.emit({
        type: "delete",
        key: "a",
        changedAt: "2026-03-09T10:06:00.000Z",
      });

      await waitFor(async () => {
        try {
          await getConfig("a");
          return false;
        } catch (error) {
          return error instanceof GaiaClientError && error.status === 404;
        }
      });

      await assert.rejects(
        () => getConfig("a"),
        (error: unknown) => {
          assert.ok(error instanceof GaiaClientError);
          assert.equal(error.code, "HTTP_ERROR");
          assert.equal(error.status, 404);
          return true;
        },
      );
      assert.equal(server.getCalls.get("a"), 1);
    },
  );
});

test("reading a new key rebuilds the SSE subscription with the full watched key set", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
      b: {
        value: "v2",
        updatedAt: "2026-03-09T10:01:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });

      await getConfig("a");
      await waitFor(() => server.subscribeRequests.length === 1);

      await getConfig("b");
      await waitFor(() => server.subscribeRequests.length === 2);

      assert.deepEqual(server.subscribeRequests[0], ["a"]);
      assert.deepEqual(server.subscribeRequests[1], ["a", "b"]);
      assert.equal(server.getCalls.get("a"), 1);
      assert.equal(server.getCalls.get("b"), 1);
    },
  );
});

test("cached values stay readable while SSE reconnects, and updates resume after reconnect", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });
      await getConfig("a");
      await waitFor(() => server.subscribeRequests.length === 1);

      server.closeLatestConnection();

      assert.deepEqual(await getConfig("a"), {
        key: "a",
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      });

      await waitFor(() => server.subscribeRequests.length === 2, 2_500);

      server.emit({
        type: "upsert",
        key: "a",
        value: "v3",
        changedAt: "2026-03-09T10:10:00.000Z",
      });

      await waitFor(async () => (await getConfig("a")).value === "v3");
    },
  );
});

test("closeGaiaClient stops subscriptions and resets initialization state", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      a: {
        value: "v1",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
    }),
    async (server) => {
      await initializeGaiaClient({ baseUrl: server.baseUrl });
      await getConfig("a");
      await waitFor(() => server.subscribeRequests.length === 1);

      await closeGaiaClient();

      await assert.rejects(
        () => getConfig("a"),
        (error: unknown) => {
          assert.ok(error instanceof GaiaClientError);
          assert.equal(error.code, "CONFIG_NOT_INITIALIZED");
          return true;
        },
      );
    },
  );
});

class FakeGaiaHttpServer {
  readonly getCalls = new Map<string, number>();
  readonly listCalls: Array<{
    query: string;
    page: number;
    pageSize: number;
  }> = [];
  readonly subscribeRequests: string[][] = [];

  baseUrl = "";

  private readonly configs = new Map<
    string,
    {
      value: string;
      updatedAt: string;
    }
  >();
  private readonly connections: Array<{
    keys: string[];
    response: ServerResponse<IncomingMessage>;
  }> = [];
  private server: HttpServer | null = null;

  constructor(
    initialConfigs: Record<
      string,
      {
        value: string;
        updatedAt: string;
      }
    >,
  ) {
    for (const [key, value] of Object.entries(initialConfigs)) {
      this.configs.set(key, value);
    }
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = this.server.address();
    assert.ok(address && typeof address === "object");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const connection of this.connections.splice(0)) {
      connection.response.destroy();
    }

    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    this.server = null;
  }

  emit(
    event:
      | {
          type: "upsert";
          key: string;
          value: string;
          changedAt: string;
        }
      | {
          type: "delete";
          key: string;
          changedAt: string;
        },
  ): void {
    if (event.type === "upsert") {
      this.configs.set(event.key, {
        value: event.value,
        updatedAt: event.changedAt,
      });
    } else {
      this.configs.delete(event.key);
    }

    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const connection of this.connections) {
      if (connection.response.destroyed || !connection.keys.includes(event.key)) {
        continue;
      }

      connection.response.write(payload);
    }
  }

  closeLatestConnection(): void {
    const connection = [...this.connections]
      .reverse()
      .find((item) => !item.response.destroyed && !item.response.writableEnded);
    connection?.response.destroy();
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/get") {
      const key = url.searchParams.get("key") ?? "";
      this.getCalls.set(key, (this.getCalls.get(key) ?? 0) + 1);

      const config = this.configs.get(key);
      if (!config) {
        this.sendJson(response, 404, {
          error: "配置不存在",
          key,
        });
        return;
      }

      this.sendJson(response, 200, {
        key,
        value: config.value,
        updatedAt: config.updatedAt,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/configs") {
      const query = url.searchParams.get("query") ?? "";
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "20");

      this.listCalls.push({ query, page, pageSize });

      const filtered = [...this.configs.entries()]
        .filter(([key]) => key.includes(query))
        .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt));

      const startIndex = (page - 1) * pageSize;
      const items = filtered.slice(startIndex, startIndex + pageSize).map(([key, config]) => ({
        key,
        valuePreview: config.value.slice(0, 80),
        updatedAt: config.updatedAt,
      }));

      this.sendJson(response, 200, {
        items,
        page,
        pageSize,
        total: filtered.length,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/subscribe") {
      const keys = url.searchParams.getAll("key");
      if (keys.length === 0) {
        this.sendJson(response, 400, { error: "至少订阅一个 key" });
        return;
      }

      this.subscribeRequests.push(keys);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(": connected\n\n");

      const connection = { keys, response };
      this.connections.push(connection);

      const cleanup = () => {
        const index = this.connections.indexOf(connection);
        if (index >= 0) {
          this.connections.splice(index, 1);
        }
      };

      request.once("close", cleanup);
      response.once("close", cleanup);
      return;
    }

    this.sendJson(response, 404, { error: "Not Found" });
  }

  private sendJson(
    response: ServerResponse<IncomingMessage>,
    statusCode: number,
    payload: unknown,
  ): void {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  }
}

async function runWithServer(
  server: FakeGaiaHttpServer,
  callback: (server: FakeGaiaHttpServer) => Promise<void>,
): Promise<void> {
  await closeGaiaClient();
  await server.start();

  try {
    await callback(server);
  } finally {
    await closeGaiaClient();
    await server.close();
  }
}

async function runWithRawServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ) => Promise<void> | void,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  await closeGaiaClient();

  const server = createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await closeGaiaClient();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  assert.fail("Timed out while waiting for condition");
}
