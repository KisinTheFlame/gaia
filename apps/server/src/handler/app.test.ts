import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "./app.js";
import { ConfigService } from "../service/configService.js";
import type {
  ConfigRepository,
  ListConfigsPage,
  ListConfigsQuery,
} from "../infra/configRepository.js";

class InMemoryConfigRepository implements ConfigRepository {
  constructor(
    private readonly entries: Array<{ key: string; value: string; updatedAt: Date }> = [],
  ) {}

  ensureSchema(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async getConfig(key: string): Promise<string | null> {
    return this.entries.find((entry) => entry.key === key)?.value ?? null;
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

  async setConfig(key: string, value: string): Promise<void> {
    const existing = this.entries.find((entry) => entry.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = new Date();
      return;
    }

    this.entries.push({
      key,
      value,
      updatedAt: new Date(),
    });
  }

  async deleteConfig(key: string): Promise<string | null> {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index === -1) {
      return null;
    }

    const [removed] = this.entries.splice(index, 1);
    return removed.value;
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
