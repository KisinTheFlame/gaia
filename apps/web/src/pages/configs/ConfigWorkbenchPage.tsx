import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircle,
  Braces,
  FilePlus2,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  deleteConfig,
  getConfig,
  listConfigs,
  setConfig,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const EMPTY_DRAFT = {
  key: "",
  value: "",
};

type DraftState = typeof EMPTY_DRAFT;
type MessageState =
  | {
      tone: "error" | "success" | "info";
      text: string;
    }
  | null;

export function ConfigWorkbenchPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<DraftState>(EMPTY_DRAFT);
  const [message, setMessage] = useState<MessageState>(null);

  const query = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const selectedKey = (searchParams.get("selected") ?? "").trim();
  const mode = searchParams.get("mode") === "new" ? "new" : selectedKey ? "edit" : "idle";
  const isEditingExisting = mode === "edit";
  const isCreatingNew = mode === "new";
  const isDirty = draft.key !== baseline.key || draft.value !== baseline.value;
  const hasDraftContent = draft.key.trim().length > 0 || draft.value.length > 0;

  const listQuery = useQuery({
    queryKey: ["configs", query, page, PAGE_SIZE],
    queryFn: () =>
      listConfigs({
        query,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const detailQuery = useQuery({
    queryKey: ["config", selectedKey],
    queryFn: () => getConfig(selectedKey),
    enabled: selectedKey.length > 0,
  });

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    if (!isCreatingNew) {
      return;
    }

    setDraft(EMPTY_DRAFT);
    setBaseline(EMPTY_DRAFT);
    setMessage(null);
  }, [isCreatingNew]);

  useEffect(() => {
    if (!detailQuery.data || !isEditingExisting) {
      return;
    }

    const nextDraft = {
      key: detailQuery.data.key,
      value: detailQuery.data.value,
    };

    setDraft(nextDraft);
    setBaseline(nextDraft);
    setMessage(null);
  }, [detailQuery.data, isEditingExisting]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [isDirty]);

  const totalPages = useMemo(() => {
    if (!listQuery.data) {
      return 1;
    }

    return Math.max(1, Math.ceil(listQuery.data.total / PAGE_SIZE));
  }, [listQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const key = draft.key.trim();
      if (!key) {
        throw new Error("key 不能为空");
      }

      return setConfig({
        key,
        value: draft.value,
      });
    },
    onSuccess: async (saved) => {
      const nextDraft = {
        key: saved.key,
        value: saved.value,
      };

      setDraft(nextDraft);
      setBaseline(nextDraft);
      setMessage({
        tone: "success",
        text: `配置 ${saved.key} 已保存`,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["configs"] }),
        queryClient.invalidateQueries({ queryKey: ["config", saved.key] }),
      ]);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("mode");
      nextParams.set("selected", saved.key);
      setSearchParams(nextParams);
    },
    onError: (error) => {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "保存配置失败"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedKey) {
        throw new Error("当前没有可删除的配置");
      }

      return deleteConfig(selectedKey);
    },
    onSuccess: async (deleted) => {
      setDraft(EMPTY_DRAFT);
      setBaseline(EMPTY_DRAFT);
      setMessage({
        tone: "success",
        text: `配置 ${deleted.key} 已删除`,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["configs"] }),
        queryClient.invalidateQueries({ queryKey: ["config", deleted.key] }),
      ]);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("selected");
      nextParams.delete("mode");
      setSearchParams(nextParams);
    },
    onError: (error) => {
      setMessage({
        tone: "error",
        text: getErrorMessage(error, "删除配置失败"),
      });
    },
  });

  function confirmDiscardChanges() {
    if (!isDirty) {
      return true;
    }

    return window.confirm("当前有未保存的更改，确定要放弃吗？");
  }

  function applySearchParams(mutator: (params: URLSearchParams) => void) {
    const nextParams = new URLSearchParams(searchParams);
    mutator(nextParams);
    setSearchParams(nextParams);
  }

  function openCreateMode() {
    if (!confirmDiscardChanges()) {
      return;
    }

    applySearchParams((params) => {
      params.delete("selected");
      params.set("mode", "new");
    });
  }

  function openConfig(key: string) {
    if (key === selectedKey && isEditingExisting) {
      return;
    }

    if (!confirmDiscardChanges()) {
      return;
    }

    applySearchParams((params) => {
      params.delete("mode");
      params.set("selected", key);
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!confirmDiscardChanges()) {
      return;
    }

    const nextQuery = searchInput.trim();
    applySearchParams((params) => {
      params.delete("selected");
      params.delete("mode");
      params.set("page", "1");
      if (nextQuery.length > 0) {
        params.set("q", nextQuery);
      } else {
        params.delete("q");
      }
    });
  }

  function handlePageChange(nextPage: number) {
    if (nextPage === page || nextPage < 1 || nextPage > totalPages) {
      return;
    }

    if (!confirmDiscardChanges()) {
      return;
    }

    applySearchParams((params) => {
      params.set("page", String(nextPage));
    });
  }

  function handleFormatJson() {
    try {
      const formatted = JSON.stringify(JSON.parse(draft.value), null, 2);
      setDraft((current) => ({
        ...current,
        value: formatted,
      }));
      setMessage({
        tone: "success",
        text: "当前值已按 JSON 重新格式化",
      });
    } catch {
      setMessage({
        tone: "error",
        text: "当前内容不是合法 JSON，无法格式化",
      });
    }
  }

  function handleDelete() {
    if (!selectedKey) {
      return;
    }

    if (!window.confirm(`确定删除配置 ${selectedKey} 吗？此操作无法撤销。`)) {
      return;
    }

    void deleteMutation.mutateAsync();
  }

  const headerSummary = listQuery.data
    ? `共 ${listQuery.data.total} 条配置，当前第 ${page}/${totalPages} 页`
    : "正在加载配置列表";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="animate-rise-in surface flex min-h-[560px] flex-col overflow-hidden [animation-delay:80ms]">
        <div className="flex flex-col gap-4 border-b border-border/60 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="accent">Registry</Badge>
                <span className="text-sm text-muted-foreground">{headerSummary}</span>
              </div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">配置列表</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void listQuery.refetch();
                }}
                disabled={listQuery.isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", listQuery.isFetching && "animate-spin")} />
                刷新
              </Button>
              <Button size="sm" onClick={openCreateMode}>
                <FilePlus2 className="h-4 w-4" />
                新建配置
              </Button>
            </div>
          </div>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSearchSubmit}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                }}
                className="pl-9"
                placeholder="按 key 搜索，例如 payment.timeout"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                搜索
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchInput("");
                  if (!query) {
                    return;
                  }

                  if (!confirmDiscardChanges()) {
                    setSearchInput(query);
                    return;
                  }

                  applySearchParams((params) => {
                    params.delete("q");
                    params.delete("selected");
                    params.delete("mode");
                    params.set("page", "1");
                  });
                }}
              >
                清空
              </Button>
            </div>
          </form>
        </div>

        <div className="flex-1 overflow-hidden">
          {listQuery.isError ? (
            <div className="flex h-full items-center justify-center px-6">
              <StatusMessage tone="error" text={getErrorMessage(listQuery.error, "读取配置列表失败")} />
            </div>
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[32%]">Key</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead className="w-[24%]">更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading ? (
                  Array.from({ length: 6 }, (_, index) => (
                    <TableRow key={`loading-${index}`}>
                      <TableCell colSpan={3}>
                        <div className="h-11 rounded-lg bg-[linear-gradient(90deg,rgba(221,235,234,0.7),rgba(255,255,255,0.95),rgba(221,235,234,0.7))] bg-[length:200%_100%] animate-shimmer" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : listQuery.data && listQuery.data.items.length > 0 ? (
                  listQuery.data.items.map((item) => (
                    <TableRow
                      key={item.key}
                      data-state={item.key === selectedKey && isEditingExisting ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => {
                        openConfig(item.key);
                      }}
                    >
                      <TableCell className="font-medium text-foreground">{item.key}</TableCell>
                      <TableCell className="max-w-0">
                        <p className="max-h-10 overflow-hidden break-all text-sm text-muted-foreground">
                          {item.valuePreview || "空字符串"}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(item.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center">
                        <div className="surface-muted px-4 py-3 text-muted-foreground">
                          当前条件下没有找到配置
                        </div>
                        <Button size="sm" variant="secondary" onClick={openCreateMode}>
                          <FilePlus2 className="h-4 w-4" />
                          新建第一条配置
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-muted-foreground">
            每页 {PAGE_SIZE} 条，支持 key 模糊搜索，列表摘要默认折叠为单行预览。
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
              上一页
            </Button>
            <span className="min-w-20 text-center text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>

      <section className="animate-rise-in surface flex min-h-[560px] flex-col overflow-hidden [animation-delay:140ms]">
        <div className="sticky top-0 z-10 border-b border-border/60 bg-white/90 px-5 py-5 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={isEditingExisting ? "primary" : "muted"}>
                    {isEditingExisting ? "Editing" : isCreatingNew ? "Creating" : "Idle"}
                  </Badge>
                  {isDirty ? (
                    <span className="text-sm font-medium text-accent-foreground">有未保存变更</span>
                  ) : null}
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight">详情与编辑</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleFormatJson}
                  disabled={!hasDraftContent}
                >
                  <Braces className="h-4 w-4" />
                  格式化 JSON
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void saveMutation.mutateAsync();
                  }}
                  disabled={saveMutation.isPending || deleteMutation.isPending || !hasDraftContent}
                >
                  <Save className="h-4 w-4" />
                  {saveMutation.isPending ? "保存中..." : "保存"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={!isEditingExisting || saveMutation.isPending || deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleteMutation.isPending ? "删除中..." : "删除"}
                </Button>
              </div>
            </div>
            {message ? <StatusMessage tone={message.tone} text={message.text} /> : null}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5 sm:px-6">
          {detailQuery.isError && isEditingExisting ? (
            <StatusMessage tone="error" text={getErrorMessage(detailQuery.error, "读取配置详情失败")} />
          ) : mode === "idle" ? (
            <EmptyEditorState onCreate={openCreateMode} />
          ) : (
            <div className="space-y-5">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">配置 Key</span>
                <Input
                  value={draft.key}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      key: event.target.value,
                    }));
                  }}
                  disabled={isEditingExisting}
                  placeholder="例如 payment.timeout"
                />
                <p className="text-sm text-muted-foreground">
                  {isEditingExisting
                    ? "首版不支持直接重命名 key，如需调整请新建新 key 并删除旧 key。"
                    : "key 不能为空，建议使用稳定、可读的命名。"}
                </p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">配置 Value</span>
                <Textarea
                  value={draft.value}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }));
                  }}
                  placeholder='支持普通字符串，也可直接粘贴 JSON，如 {"enabled": true}'
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  存储模型保持为字符串；如果内容本身是 JSON，可以使用“格式化 JSON”提升可读性。
                </p>
              </label>

              {detailQuery.isFetching && isEditingExisting ? (
                <div className="surface-muted px-4 py-3 text-sm text-muted-foreground">
                  正在同步当前配置详情...
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyEditorState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 text-center">
      <div className="surface-muted max-w-md px-6 py-5">
        <p className="font-display text-xl font-semibold text-foreground">还没有选中配置</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          从左侧选择一条配置查看详情，或直接开始创建新的配置项。
        </p>
      </div>
      <Button onClick={onCreate}>
        <FilePlus2 className="h-4 w-4" />
        新建配置
      </Button>
    </div>
  );
}

function StatusMessage({
  tone,
  text,
}: {
  tone: "error" | "success" | "info";
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-6",
        tone === "error" && "border-destructive/25 bg-destructive/10 text-destructive",
        tone === "success" && "border-primary/20 bg-primary/10 text-primary",
        tone === "info" && "border-border bg-secondary/60 text-secondary-foreground",
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
