import assert from "node:assert/strict";
import { get as httpGet, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "./app.js";
import { ConfigService } from "../service/configService.js";
import type {
  ConfigRepository,
  DeletedConfigRecord,
  ListConfigsPage,
  ListConfigsQuery,
  StoredConfigRecord,
} from "../infra/configRepository.js";

class InMemoryConfigRepository implements ConfigRepository {
  constructor(
    private readonly entries: Array<{ key: string; value: string; updatedAt: Date }> = [],
  ) {}

  waitUntilReady(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async getConfig(key: string): Promise<StoredConfigRecord | null> {
    const entry = this.entries.find((item) => item.key === key);
    if (!entry) {
      return null;
    }

    return {
      key: entry.key,
      value: entry.value,
      updatedAt: entry.updatedAt,
    };
  }

  async listConfigs(input: ListConfigsQuery): Promise<ListConfigsPage> {
    const filtered = this.entries
      .filter((entry) => entry.key.toLowerCase().includes(input.query.toLowerCase()))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const offset = (input.page - 1) * input.pageSize;

    return {
      items: filtered.slice(offset, offset + input.pageSize),
      page: input.page,
      pageSize: input.pageSize,
      total: filtered.length,
    };
  }

  async setConfig(key: string, value: string): Promise<StoredConfigRecord> {
    const existing = this.entries.find((entry) => entry.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = new Date();
      return {
        key: existing.key,
        value: existing.value,
        updatedAt: existing.updatedAt,
      };
    }

    const created = {
      key,
      value,
      updatedAt: new Date(),
    };
    this.entries.push(created);
    return created;
  }

  async deleteConfig(key: string): Promise<DeletedConfigRecord | null> {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index === -1) {
      return null;
    }

    const [removed] = this.entries.splice(index, 1);
    return {
      key: removed.key,
      value: removed.value,
    };
  }
}

test("GET /configs returns an empty page", async () => {
  const app = createApp(new ConfigService(new InMemoryConfigRepository()));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/configs",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  } finally {
    await app.close();
  }
});

test("GET /configs supports pagination and returns previews", async () => {
  const app = createApp(
    new ConfigService(
      new InMemoryConfigRepository([
        {
          key: "feature-a",
          value: "alpha",
          updatedAt: new Date("2026-03-08T01:00:00.000Z"),
        },
        {
          key: "feature-b",
          value: "beta\n".repeat(50),
          updatedAt: new Date("2026-03-08T03:00:00.000Z"),
        },
        {
          key: "feature-c",
          value: "gamma",
          updatedAt: new Date("2026-03-08T02:00:00.000Z"),
        },
      ]),
    ),
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/configs?page=2&pageSize=1",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [
        {
          key: "feature-c",
          valuePreview: "gamma",
          updatedAt: "2026-03-08T02:00:00.000Z",
        },
      ],
      page: 2,
      pageSize: 1,
      total: 3,
    });
  } finally {
    await app.close();
  }
});

test("GET /configs filters by key query", async () => {
  const app = createApp(
    new ConfigService(
      new InMemoryConfigRepository([
        {
          key: "payment.timeout",
          value: "1500",
          updatedAt: new Date("2026-03-08T01:00:00.000Z"),
        },
        {
          key: "message.template",
          value: "hello",
          updatedAt: new Date("2026-03-08T02:00:00.000Z"),
        },
      ]),
    ),
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/configs?query=payment",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [
        {
          key: "payment.timeout",
          valuePreview: "1500",
          updatedAt: "2026-03-08T01:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  } finally {
    await app.close();
  }
});

test("GET /configs returns empty items for pages beyond the result set", async () => {
  const app = createApp(
    new ConfigService(
      new InMemoryConfigRepository([
        {
          key: "feature.flag",
          value: "on",
          updatedAt: new Date("2026-03-08T01:00:00.000Z"),
        },
      ]),
    ),
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/configs?page=3&pageSize=1",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [],
      page: 3,
      pageSize: 1,
      total: 1,
    });
  } finally {
    await app.close();
  }
});

test("GET /subscribe rejects an empty key list", async () => {
  const app = createApp(new ConfigService(new InMemoryConfigRepository()));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/subscribe",
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "至少订阅一个 key",
    });
  } finally {
    await app.close();
  }
});

test("SSE subscribers receive upsert events for matching keys", async () => {
  const app = createApp(new ConfigService(new InMemoryConfigRepository()));
  const listener = await openSseConnection(app, "/subscribe?key=feature.flag");

  try {
    const response = await app.inject({
      method: "POST",
      url: "/set",
      payload: {
        key: "feature.flag",
        value: "on",
      },
    });

    assert.equal(response.statusCode, 200);

    const event = await listener.nextEvent();
    assert.deepEqual(event, {
      type: "upsert",
      key: "feature.flag",
      value: "on",
      changedAt: response.json().updatedAt,
    });
  } finally {
    await listener.close();
  }
});

test("SSE subscribers receive delete events for matching keys", async () => {
  const app = createApp(
    new ConfigService(
      new InMemoryConfigRepository([
        {
          key: "feature.flag",
          value: "on",
          updatedAt: new Date("2026-03-08T01:00:00.000Z"),
        },
      ]),
    ),
  );
  const listener = await openSseConnection(app, "/subscribe?key=feature.flag");

  try {
    const response = await app.inject({
      method: "DELETE",
      url: "/delete?key=feature.flag",
    });

    assert.equal(response.statusCode, 200);

    const event = await listener.nextEvent();
    assert.deepEqual(event, {
      type: "delete",
      key: "feature.flag",
      changedAt: response.json().changedAt,
    });
  } finally {
    await listener.close();
  }
});

test("SSE subscribers do not receive events for unrelated keys", async () => {
  const app = createApp(new ConfigService(new InMemoryConfigRepository()));
  const listener = await openSseConnection(app, "/subscribe?key=feature.flag");

  try {
    const response = await app.inject({
      method: "POST",
      url: "/set",
      payload: {
        key: "other.feature",
        value: "off",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(await listener.nextEvent(200), null);
  } finally {
    await listener.close();
  }
});

async function openSseConnection(app: ReturnType<typeof createApp>, pathname: string) {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  let requestRef: ReturnType<typeof httpGet> | null = null;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpGet(`${address}${pathname}`, { agent: false }, (incoming) => {
      resolve(incoming);
    });
    requestRef = request;

    request.once("error", reject);
  });

  assert.equal(response.statusCode, 200);
  const reader = createSseEventReader(Readable.toWeb(response) as ReadableStream<Uint8Array>);

  return {
    nextEvent: (timeoutMs?: number) => reader.nextEvent(timeoutMs),
    async close() {
      await reader.close();
      requestRef?.destroy();
    },
  };
}

function createSseEventReader(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

  return {
    async nextEvent(timeoutMs = 1_000): Promise<unknown | null> {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        while (true) {
          const extracted = extractSseEvent(buffer);
          if (!extracted.consumed) {
            break;
          }

          buffer = extracted.rest;
          if (extracted.event !== null) {
            return extracted.event;
          }
        }

        const chunk = await readWithTimeout(reader, deadline - Date.now());
        if (chunk === null || chunk.done) {
          return null;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
      }

      return null;
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined);
    },
  };
}

function extractSseEvent(buffer: string): { consumed: boolean; event: unknown | null; rest: string } {
  const separatorIndex = buffer.indexOf("\n\n");
  if (separatorIndex === -1) {
    return { consumed: false, event: null, rest: buffer };
  }

  const rawEvent = buffer.slice(0, separatorIndex);
  const rest = buffer.slice(separatorIndex + 2);
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return { consumed: true, event: null, rest };
  }

  return {
    consumed: true,
    event: JSON.parse(dataLines.join("\n")),
    rest,
  };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  if (timeoutMs <= 0) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
