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

await repository.ensureSchema(appConfig.dbInitRetries, appConfig.dbInitRetryDelayMs);

app.listen(appConfig.port, () => {
  console.log(`Server is running at http://localhost:${appConfig.port}`);
  console.log(
    `Config storage: postgresql://${appConfig.dbUser}@${appConfig.dbHost}:${appConfig.dbPort}/${appConfig.dbName}`,
  );
});
