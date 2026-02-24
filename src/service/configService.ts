import type { ConfigRepository } from "../infra/configRepository.js";

export class ConfigService {
  constructor(private readonly repository: ConfigRepository) {}

  getConfig(key: string): Promise<string | null> {
    return this.repository.getConfig(key);
  }

  setConfig(key: string, value: string): Promise<void> {
    return this.repository.setConfig(key, value);
  }

  deleteConfig(key: string): Promise<string | null> {
    return this.repository.deleteConfig(key);
  }
}
