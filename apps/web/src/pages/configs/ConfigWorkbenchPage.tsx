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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  deleteConfig,
  getConfig,
  listConfigs,
  setConfig,
} from "@/lib/api";
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
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("selected");
      nextParams.delete("mode");

      setDraft(EMPTY_DRAFT);
      setBaseline(EMPTY_DRAFT);
      setMessage({
        tone: "success",
        text: `配置 ${deleted.key} 已删除`,
      });
      setSearchParams(nextParams);

      await queryClient.cancelQueries({ queryKey: ["config", deleted.key] });
      queryClient.removeQueries({ queryKey: ["config", deleted.key] });
      await queryClient.invalidateQueries({ queryKey: ["configs"] });
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

  const modeLabel = isEditingExisting ? "编辑中" : isCreatingNew ? "新建中" : "等待选择";
  const modeVariant = isEditingExisting ? "default" : isCreatingNew ? "secondary" : "outline";

  return (
    <div className="flex min-h-full w-full flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Card className="flex min-h-[520px] flex-col">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle className="text-xl">配置列表</CardTitle>
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
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-0">
            {listQuery.isError ? (
              <div className="flex h-full items-center justify-center px-6">
                <StatusMessage tone="error" text={getErrorMessage(listQuery.error, "读取配置列表失败")} />
              </div>
            ) : (
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[38%]">Key</TableHead>
                    <TableHead>摘要</TableHead>
                    <TableHead className="w-[26%]">更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listQuery.isLoading
                    ? Array.from({ length: 6 }, (_, index) => (
                        <TableRow key={`loading-${index}`}>
                          <TableCell colSpan={3}>
                            <Skeleton className="h-10 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : listQuery.data && listQuery.data.items.length > 0
                      ? listQuery.data.items.map((item) => (
                          <TableRow
                            key={item.key}
                            data-state={item.key === selectedKey && isEditingExisting ? "selected" : undefined}
                            className="cursor-pointer"
                            onClick={() => {
                              openConfig(item.key);
                            }}
                          >
                            <TableCell className="font-medium">
                              <span className="block truncate" title={item.key}>
                                {item.key}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-0">
                              <p className="truncate text-sm text-muted-foreground" title={item.valuePreview || "空字符串"}>
                                {item.valuePreview || "空字符串"}
                              </p>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDateTime(item.updatedAt)}
                            </TableCell>
                          </TableRow>
                        ))
                      : (
                          <TableRow>
                            <TableCell colSpan={3}>
                              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">当前条件下没有找到配置</p>
                                  <p className="text-sm text-muted-foreground">
                                    你可以调整关键字，或者直接创建第一条配置。
                                  </p>
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
          </CardContent>

          <CardFooter className="justify-end border-t">
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
          </CardFooter>
        </Card>

        <Card className="flex min-h-[520px] flex-col">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={modeVariant}>{modeLabel}</Badge>
                  {isDirty ? <Badge variant="secondary">未保存变更</Badge> : null}
                </div>
                <CardTitle className="text-xl">详情与编辑</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
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
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col overflow-auto">
            {detailQuery.isError && isEditingExisting ? (
              <StatusMessage tone="error" text={getErrorMessage(detailQuery.error, "读取配置详情失败")} />
            ) : mode === "idle" ? (
              <EmptyEditorState onCreate={openCreateMode} />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <EditorHint
                    title="编辑规则"
                    description={
                      isEditingExisting
                        ? "当前版本不支持直接重命名 key，如需调整请创建新 key 后删除旧 key。"
                        : "建议使用稳定、可读的 key 命名，避免将环境信息直接写进 key。"
                    }
                  />
                  <EditorHint
                    title="值格式"
                    description="配置值仍以字符串存储；如果粘贴的是 JSON，可以用上方按钮做格式化。"
                  />
                </div>

                <label className="grid gap-2">
                  <span className="text-sm font-medium">配置 Key</span>
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
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium">配置 Value</span>
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
                </label>

                {detailQuery.isFetching && isEditingExisting ? (
                  <StatusMessage tone="info" text="正在同步当前配置详情..." />
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EditorHint({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function EmptyEditorState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-2">
        <p className="text-lg font-semibold">还没有选中配置</p>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          从左侧列表选择配置查看详情，或者直接开始创建新的配置项。
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
        tone === "error" && "border-destructive/20 bg-destructive/10 text-destructive",
        tone === "success" && "border-primary/20 bg-primary/10 text-primary",
        tone === "info" && "border-border bg-muted/60 text-muted-foreground",
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
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
