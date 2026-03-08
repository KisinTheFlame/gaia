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

export interface ConfigRecordResult {
  key: string;
  value: string;
  updatedAt: string;
}

export interface DeletedConfigResult {
  key: string;
  value: string;
}

const PREVIEW_LENGTH = 120;

export class ConfigService {
  constructor(private readonly repository: ConfigRepository) {}

  async getConfig(key: string): Promise<ConfigRecordResult | null> {
    const result = await this.repository.getConfig(key);
    if (result === null) {
      return null;
    }

    return {
      key: result.key,
      value: result.value,
      updatedAt: result.updatedAt.toISOString(),
    };
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

  async setConfig(key: string, value: string): Promise<ConfigRecordResult> {
    const result = await this.repository.setConfig(key, value);
    return {
      key: result.key,
      value: result.value,
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  deleteConfig(key: string): Promise<DeletedConfigResult | null> {
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
