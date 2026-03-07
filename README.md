# Gaia Config Center Monorepo

Gaia 现已改造为 `pnpm` monorepo，包含服务端、共享协议包和 SDK。

## Workspace 结构

- `apps/server` -> `@kisintheflame/gaia-server`（私有，配置中心服务）
- `apps/web` -> `@kisintheflame/gaia-web`（私有，配置管控前端）
- `packages/shared` -> `@kisintheflame/gaia-shared`（Zod 协议与类型）
- `packages/client` -> `@kisintheflame/gaia-client`（Node ESM SDK）

## 本地开发

```bash
pnpm install
docker network create axis
docker compose up -d postgres
pnpm db:migrate:deploy
pnpm dev
```

前端本地启动：

```bash
pnpm dev:web
```

- 后端默认运行在 `http://localhost:20005`
- 前端 Vite 默认运行在 `http://localhost:20006`

常用命令：

```bash
pnpm build
pnpm db:migrate:dev -- --name <migration_name>
pnpm db:migrate:deploy
pnpm db:migrate:status
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

Prisma migration 流程：

- 修改 `apps/server/prisma/schema.prisma`
- 执行 `pnpm db:migrate:dev -- --name <migration_name>` 生成迁移文件
- 提交 `apps/server/prisma/migrations/*` 与 schema 变更
- 部署前执行 `pnpm db:migrate:deploy`，或直接使用 `pnpm run app:deploy`

## 服务端 API

- `GET /configs?query=<query>&page=<page>&pageSize=<pageSize>`
- `GET /get?key=<key>`
- `POST /set` body: `{"key":"<key>","value":"<value>"}`
- `DELETE /delete?key=<key>`

## SDK 使用（@kisintheflame/gaia-client）

先在业务项目根目录准备 `gaia.config.yml`：

```yaml
baseUrl: http://localhost:20005
```

示例：

```ts
import {
  deleteConfig,
  getConfig,
  initializeGaiaClient,
  setConfig,
} from "@kisintheflame/gaia-client";

await initializeGaiaClient();
await setConfig("demo", "v1");
const got = await getConfig("demo");
await deleteConfig("demo");
console.log(got.value);
```

SDK 规则：

- 必须先调用 `initializeGaiaClient()`
- 默认读取 `process.cwd()/gaia.config.yml`
- 入参和响应都做 Zod 校验
- 错误统一抛 `GaiaClientError`

## Docker

构建镜像：

```bash
docker build -f apps/server/Dockerfile -t gaia-config-center:latest .
```

启动 compose：

```bash
docker network create axis
pnpm run app:deploy
```

服务：

- `postgres` (`postgres:16-alpine`)
- `gaia-config-center`（对外端口 `20005`）
- `gaia-web`（对外端口 `20006`，通过 `/api` 反代到 `gaia-config-center`）

## GitHub Packages

scope：`@kisintheflame`

仓库 `.npmrc` 已设置：

```ini
@kisintheflame:registry=https://npm.pkg.github.com
```

发布 workflow：`.github/workflows/publish-packages.yml`

- 触发：推送 `v*` tag
- 发布包：`@kisintheflame/gaia-shared`、`@kisintheflame/gaia-client`
