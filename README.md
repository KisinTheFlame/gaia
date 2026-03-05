# Gaia Config Center Monorepo

Gaia 现已改造为 `pnpm` monorepo，包含服务端、共享协议包和 SDK。

## Workspace 结构

- `apps/server` -> `@kisintheflame/gaia-server`（私有，配置中心服务）
- `packages/shared` -> `@kisintheflame/gaia-shared`（Zod 协议与类型）
- `packages/client` -> `@kisintheflame/gaia-client`（Node ESM SDK）

## 本地开发

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```

## 服务端 API

- `GET /get?key=<key>`
- `POST /set` body: `{"key":"<key>","value":"<value>"}`
- `DELETE /delete?key=<key>`

## SDK 使用（@kisintheflame/gaia-client）

先在业务项目根目录准备 `gaia.config.yml`：

```yaml
baseUrl: http://localhost:33000
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
docker build -t gaia-config-center:latest .
```

启动 compose：

```bash
docker compose up -d --build
```

服务：

- `postgres` (`postgres:16-alpine`)
- `gaia-config-center`（对外端口 `33000`）

## GitHub Packages

scope：`@kisintheflame`

仓库 `.npmrc` 已设置：

```ini
@kisintheflame:registry=https://npm.pkg.github.com
```

发布 workflow：`.github/workflows/publish-packages.yml`

- 触发：推送 `v*` tag
- 发布包：`@kisintheflame/gaia-shared`、`@kisintheflame/gaia-client`
