import { Database, Settings2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navItems = [{ to: "/configs", label: "配置工作台", icon: Database }];

export function Sidebar() {
  return (
    <>
      <aside className="hidden h-screen w-60 flex-col border-r bg-background md:flex">
        <div className="border-b px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Settings2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold tracking-tight">Gaia</div>
              <Badge variant="secondary" className="text-[10px]">
                Config Center
              </Badge>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <header className="border-b bg-background px-4 py-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold tracking-tight">Gaia</p>
            <p className="text-xs text-muted-foreground">Config Center</p>
          </div>
          <Badge variant="secondary">shadcn UI</Badge>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
    </>
  );
}
