import { Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="animate-rise-in surface mb-6 overflow-hidden px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="font-display text-sm font-semibold uppercase tracking-[0.32em] text-primary">
                Gaia Config Center
              </p>
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  配置管控台
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  面向运维与研发的轻量工作台，用更直接的方式管理 key/value 配置、搜索上下文并处理日常变更。
                </p>
              </div>
            </div>
            <div className="surface-muted max-w-sm px-4 py-3 text-sm leading-6 text-muted-foreground">
              通过左侧列表快速定位配置，右侧完成查看、编辑与删除。首版默认在受信内网环境中使用。
            </div>
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
