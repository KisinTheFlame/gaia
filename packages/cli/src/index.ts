import path from "node:path";

import {
  closeGaiaClient,
  deleteConfig,
  getConfig,
  initializeGaiaClient,
  listConfigs,
  setConfig,
} from "@kisinwen/gaia-client";

type Writable = {
  write(chunk: string): void;
};

export type CliIo = {
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
};

type ParsedCommand =
  | {
      kind: "set";
      key: string;
      value: string;
      configPath: string;
    }
  | {
      kind: "get";
      key: string;
      configPath: string;
    }
  | {
      kind: "delete";
      key: string;
      configPath: string;
    }
  | {
      kind: "search";
      query: string;
      configPath: string;
    };

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const USAGE = [
  "用法:",
  "  gaia set <key> <value> [--json] [--config <path>]",
  "  gaia get <key> [--config <path>]",
  "  gaia delete <key> [--config <path>]",
  "  gaia search <query> [--config <path>]",
].join("\n");

export async function runCli(args: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();

  try {
    const command = parseCommand(args, cwd);

    await initializeGaiaClient({ configPath: command.configPath });

    try {
      return await executeCommand(command, stdout);
    } finally {
      await closeGaiaClient();
    }
  } catch (error) {
    try {
      await closeGaiaClient();
    } catch {
      // Ignore cleanup failures so the original CLI error stays visible.
    }

    stderr.write(formatErrorMessage(error));
    return 1;
  }
}

async function executeCommand(command: ParsedCommand, stdout: Writable): Promise<number> {
  switch (command.kind) {
    case "set": {
      const saved = await setConfig(command.key, command.value);
      stdout.write(`已保存配置 ${saved.key}\n`);
      return 0;
    }
    case "get": {
      const config = await getConfig(command.key);
      stdout.write(`key: ${config.key}\nupdatedAt: ${config.updatedAt}\nvalue:\n${config.value}\n`);
      return 0;
    }
    case "delete": {
      const deleted = await deleteConfig(command.key);
      stdout.write(`已删除配置 ${deleted.key}\n`);
      return 0;
    }
    case "search": {
      const result = await listConfigs({
        query: command.query,
        page: 1,
        pageSize: 100,
      });

      if (result.items.length === 0) {
        stdout.write("未找到匹配配置\n");
        return 0;
      }

      stdout.write(`${result.items.map((item) => item.key).join("\n")}\n`);
      return 0;
    }
  }
}

function parseCommand(args: string[], cwd: string): ParsedCommand {
  if (args.length === 0) {
    throw new CliUsageError(`缺少命令\n${USAGE}`);
  }

  const [command, ...restArgs] = args;
  const parsed = parseSharedArgs(restArgs, cwd);

  switch (command) {
    case "set": {
      if (parsed.positionals.length !== 2) {
        throw new CliUsageError(`set 命令需要 <key> <value>\n${USAGE}`);
      }

      const value = parsed.jsonMode
        ? normalizeJsonValue(parsed.positionals[1])
        : parsed.positionals[1];
      return {
        kind: "set",
        key: parsed.positionals[0],
        value,
        configPath: parsed.configPath,
      };
    }
    case "get": {
      if (parsed.jsonMode) {
        throw new CliUsageError(`--json 仅支持 set 命令\n${USAGE}`);
      }
      if (parsed.positionals.length !== 1) {
        throw new CliUsageError(`get 命令需要 <key>\n${USAGE}`);
      }

      return {
        kind: "get",
        key: parsed.positionals[0],
        configPath: parsed.configPath,
      };
    }
    case "delete": {
      if (parsed.jsonMode) {
        throw new CliUsageError(`--json 仅支持 set 命令\n${USAGE}`);
      }
      if (parsed.positionals.length !== 1) {
        throw new CliUsageError(`delete 命令需要 <key>\n${USAGE}`);
      }

      return {
        kind: "delete",
        key: parsed.positionals[0],
        configPath: parsed.configPath,
      };
    }
    case "search": {
      if (parsed.jsonMode) {
        throw new CliUsageError(`--json 仅支持 set 命令\n${USAGE}`);
      }
      if (parsed.positionals.length !== 1) {
        throw new CliUsageError(`search 命令需要 <query>\n${USAGE}`);
      }

      return {
        kind: "search",
        query: parsed.positionals[0],
        configPath: parsed.configPath,
      };
    }
    default:
      throw new CliUsageError(`未知命令: ${command}\n${USAGE}`);
  }
}

function parseSharedArgs(
  args: string[],
  cwd: string,
): {
  configPath: string;
  jsonMode: boolean;
  positionals: string[];
} {
  const positionals: string[] = [];
  let configPath = path.resolve(cwd, "gaia.config.yml");
  let jsonMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--config") {
      const rawPath = args[index + 1];
      if (!rawPath) {
        throw new CliUsageError(`--config 需要提供文件路径\n${USAGE}`);
      }

      configPath = path.resolve(cwd, rawPath);
      index += 1;
      continue;
    }

    if (token === "--json") {
      jsonMode = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new CliUsageError(`未知选项: ${token}\n${USAGE}`);
    }

    positionals.push(token);
  }

  return {
    configPath,
    jsonMode,
    positionals,
  };
}

function normalizeJsonValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch (error) {
    throw new CliUsageError(
      `--json 需要提供合法的 JSON 值: ${error instanceof Error ? error.message : "解析失败"}\n${USAGE}`,
    );
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n`;
  }

  return "命令执行失败\n";
}
