import { createApp } from "./handler/app.js";
import { loadAppConfig } from "./infra/config.js";
import { PgConfigRepository } from "./infra/configRepository.js";
import { ConfigService } from "./service/configService.js";

const appConfig = loadAppConfig();

const repository = new PgConfigRepository({
  host: appConfig.dbHost,
  port: appConfig.dbPort,
  database: appConfig.dbName,
  user: appConfig.dbUser,
  password: appConfig.dbPassword,
});

const configService = new ConfigService(repository);
const app = createApp(configService);

try {
  await repository.ensureSchema(appConfig.dbInitRetries, appConfig.dbInitRetryDelayMs);
  const address = await app.listen({ port: appConfig.port, host: "0.0.0.0" });

  console.log(`Server is running at ${address}`);
  console.log(
    `Config storage: postgresql://${appConfig.dbUser}@${appConfig.dbHost}:${appConfig.dbPort}/${appConfig.dbName}`,
  );
} catch (error) {
  console.error("服务启动失败:", error);
  await repository.close();
  process.exit(1);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，开始优雅停机`);
  await app.close();
  await repository.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
