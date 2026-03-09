import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import test from "node:test";

import { runCli } from "./index.js";

test("set stores plain string values", async () => {
  await runWithServer(new FakeGaiaHttpServer({}), async (server) => {
    const projectDir = await createProjectDir(server.baseUrl);
    const io = createIo(projectDir);

    const exitCode = await runCli(["set", "demo.key", "v1"], io);

    assert.equal(exitCode, 0);
    assert.equal(io.getOutput("stdout"), "已保存配置 demo.key\n");
    assert.equal(io.getOutput("stderr"), "");
    assert.equal(server.readValue("demo.key"), "v1");
  });
});

test("set --json validates and formats JSON before saving", async () => {
  await runWithServer(new FakeGaiaHttpServer({}), async (server) => {
    const projectDir = await createProjectDir(server.baseUrl);
    const io = createIo(projectDir);

    const exitCode = await runCli(
      ["set", "feature.flags", '{"checkoutV2":true,"gray":20}', "--json"],
      io,
    );

    assert.equal(exitCode, 0);
    assert.equal(server.readValue("feature.flags"), '{\n  "checkoutV2": true,\n  "gray": 20\n}');
  });
});

test("get prints key, updatedAt, and value", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      "demo.key": {
        value: "v1",
        updatedAt: "2026-03-10T01:00:00.000Z",
      },
    }),
    async (server) => {
      const projectDir = await createProjectDir(server.baseUrl);
      const io = createIo(projectDir);

      const exitCode = await runCli(["get", "demo.key"], io);

      assert.equal(exitCode, 0);
      assert.equal(
        io.getOutput("stdout"),
        "key: demo.key\nupdatedAt: 2026-03-10T01:00:00.000Z\nvalue:\nv1\n",
      );
      assert.equal(io.getOutput("stderr"), "");
    },
  );
});

test("delete prints an error and exits with 1 when the config is missing", async () => {
  await runWithServer(new FakeGaiaHttpServer({}), async (server) => {
    const projectDir = await createProjectDir(server.baseUrl);
    const io = createIo(projectDir);

    const exitCode = await runCli(["delete", "missing.key"], io);

    assert.equal(exitCode, 1);
    assert.equal(io.getOutput("stdout"), "");
    assert.match(io.getOutput("stderr"), /配置不存在/);
  });
});

test("search only prints matching keys", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      "payment.retry": {
        value: "2",
        updatedAt: "2026-03-10T01:00:00.000Z",
      },
      "payment.timeout": {
        value: "3000",
        updatedAt: "2026-03-10T01:01:00.000Z",
      },
      "user.theme": {
        value: "dark",
        updatedAt: "2026-03-10T01:02:00.000Z",
      },
    }),
    async (server) => {
      const projectDir = await createProjectDir(server.baseUrl);
      const io = createIo(projectDir);

      const exitCode = await runCli(["search", "payment"], io);

      assert.equal(exitCode, 0);
      assert.equal(io.getOutput("stdout"), "payment.timeout\npayment.retry\n");
      assert.equal(io.getOutput("stderr"), "");
      assert.deepEqual(server.listCalls[0], {
        query: "payment",
        page: 1,
        pageSize: 100,
      });
    },
  );
});

test("search prints a no-result message and still exits with 0", async () => {
  await runWithServer(new FakeGaiaHttpServer({}), async (server) => {
    const projectDir = await createProjectDir(server.baseUrl);
    const io = createIo(projectDir);

    const exitCode = await runCli(["search", "payment"], io);

    assert.equal(exitCode, 0);
    assert.equal(io.getOutput("stdout"), "未找到匹配配置\n");
    assert.equal(io.getOutput("stderr"), "");
    assert.equal(server.listCalls.length, 1);
  });
});

test("the default config path only uses the current directory", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      "demo.key": {
        value: "v1",
        updatedAt: "2026-03-10T01:00:00.000Z",
      },
    }),
    async (server) => {
      const projectDir = await createProjectDir(server.baseUrl);
      const nestedDir = join(projectDir, "nested");
      await mkdir(nestedDir);

      const io = createIo(nestedDir);
      const exitCode = await runCli(["get", "demo.key"], io);

      assert.equal(exitCode, 1);
      assert.equal(io.getOutput("stdout"), "");
      assert.match(io.getOutput("stderr"), /未找到配置文件/);
    },
  );
});

test("--config overrides the default config lookup", async () => {
  await runWithServer(
    new FakeGaiaHttpServer({
      "demo.key": {
        value: "v1",
        updatedAt: "2026-03-10T01:00:00.000Z",
      },
    }),
    async (server) => {
      const projectDir = await createProjectDir(server.baseUrl);
      const nestedDir = join(projectDir, "nested");
      await mkdir(nestedDir);

      const io = createIo(nestedDir);
      const exitCode = await runCli(["get", "demo.key", "--config", "../gaia.config.yml"], io);

      assert.equal(exitCode, 0);
      assert.equal(
        io.getOutput("stdout"),
        "key: demo.key\nupdatedAt: 2026-03-10T01:00:00.000Z\nvalue:\nv1\n",
      );
      assert.equal(io.getOutput("stderr"), "");
    },
  );
});

test("invalid commands return exit code 1", async () => {
  const io = createIo(process.cwd());

  const exitCode = await runCli(["unknown"], io);

  assert.equal(exitCode, 1);
  assert.equal(io.getOutput("stdout"), "");
  assert.match(io.getOutput("stderr"), /未知命令/);
});

type ConfigRecord = {
  value: string;
  updatedAt: string;
};

const tempDirectories: string[] = [];

class FakeGaiaHttpServer {
  readonly listCalls: Array<{
    query: string;
    page: number;
    pageSize: number;
  }> = [];
  readonly subscribeRequests: string[][] = [];

  baseUrl = "";

  private readonly configs = new Map<string, ConfigRecord>();
  private server: HttpServer | null = null;
  private versionCounter = 0;

  constructor(initialConfigs: Record<string, ConfigRecord>) {
    for (const [key, value] of Object.entries(initialConfigs)) {
      this.configs.set(key, value);
    }
  }

  readValue(key: string): string | undefined {
    return this.configs.get(key)?.value;
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

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/get") {
      const key = url.searchParams.get("key") ?? "";
      const config = this.configs.get(key);

      if (!config) {
        this.sendJson(response, 404, { error: "配置不存在", key });
        return;
      }

      this.sendJson(response, 200, {
        key,
        value: config.value,
        updatedAt: config.updatedAt,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/set") {
      const payload = await this.readJsonBody(request);
      const key = typeof payload.key === "string" ? payload.key : "";
      const value = typeof payload.value === "string" ? payload.value : "";
      const updatedAt = this.nextTimestamp();

      this.configs.set(key, { value, updatedAt });
      this.sendJson(response, 200, {
        key,
        value,
        updatedAt,
      });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/delete") {
      const key = url.searchParams.get("key") ?? "";
      const existing = this.configs.get(key);

      if (!existing) {
        this.sendJson(response, 404, { error: "配置不存在", key });
        return;
      }

      this.configs.delete(key);
      this.sendJson(response, 200, {
        key,
        value: existing.value,
        deleted: true,
        changedAt: this.nextTimestamp(),
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
      const items = filtered.slice(startIndex, startIndex + pageSize).map(([key, value]) => ({
        key,
        valuePreview: value.value.slice(0, 80),
        updatedAt: value.updatedAt,
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
      this.subscribeRequests.push(keys);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(": connected\n\n");
      request.once("close", () => {
        response.end();
      });
      return;
    }

    this.sendJson(response, 404, { error: "Not Found" });
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(body) as Record<string, unknown>;
  }

  private nextTimestamp(): string {
    this.versionCounter += 1;
    return new Date(Date.UTC(2026, 2, 10, 1, 0, this.versionCounter)).toISOString();
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
  await server.start();

  try {
    await callback(server);
  } finally {
    await server.close();
  }
}

async function createProjectDir(baseUrl: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gaia-cli-test-"));
  tempDirectories.push(directory);
  await writeFile(join(directory, "gaia.config.yml"), `baseUrl: ${baseUrl}\n`, "utf8");
  return directory;
}

function createIo(cwd: string): {
  cwd: string;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  getOutput(stream: "stdout" | "stderr"): string;
} {
  let stdoutBuffer = "";
  let stderrBuffer = "";

  return {
    cwd,
    stdout: {
      write(chunk: string) {
        stdoutBuffer += chunk;
      },
    },
    stderr: {
      write(chunk: string) {
        stderrBuffer += chunk;
      },
    },
    getOutput(stream: "stdout" | "stderr") {
      return stream === "stdout" ? stdoutBuffer : stderrBuffer;
    },
  };
}

test.after(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
