import type { ConfigRepository } from "../infra/configRepository.js";

export interface ListConfigsInput {
  query: string;
  page: number;
  pageSize: number;
}

export interface ConfigListItemSummary {
  key: string;
  valuePreview: string;
  updatedAt: string;
}

export interface ListConfigsResult {
  items: ConfigListItemSummary[];
  page: number;
  pageSize: number;
  total: number;
}

const PREVIEW_LENGTH = 120;

export class ConfigService {
  constructor(private readonly repository: ConfigRepository) {}

  getConfig(key: string): Promise<string | null> {
    return this.repository.getConfig(key);
  }

  async listConfigs(input: ListConfigsInput): Promise<ListConfigsResult> {
    const result = await this.repository.listConfigs(input);

    return {
      items: result.items.map((item) => ({
        key: item.key,
        valuePreview: buildValuePreview(item.value),
        updatedAt: item.updatedAt.toISOString(),
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  setConfig(key: string, value: string): Promise<void> {
    return this.repository.setConfig(key, value);
  }

  deleteConfig(key: string): Promise<string | null> {
    return this.repository.deleteConfig(key);
  }
}

function buildValuePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, PREVIEW_LENGTH - 3)}...`;
}
