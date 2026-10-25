"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuickAdd } from "@/components/capture/quick-add";
import { UI } from "@/lib/icons";
import { APP_NAME } from "@/lib/env";

const NAV = [
  { href: "/", label: "Home", Icon: UI.House, match: (p: string) => p === "/" || p.startsWith("/cash") },
  { href: "/activity", label: "Activity", Icon: UI.List, match: (p: string) => p.startsWith("/activity") },
  { href: "/analytics", label: "Analytics", Icon: UI.ChartNoAxesColumn, match: (p: string) => p.startsWith("/analytics") },
  { href: "/insights", label: "Insights", Icon: UI.Sparkles, match: (p: string) => p.startsWith("/insights") },
  { href: "/bills", label: "Bills", Icon: UI.Repeat, match: (p: string) => p.startsWith("/bills") },
  { href: "/settings/accounts", label: "Accounts", Icon: UI.Landmark, match: (p: string) => p.startsWith("/settings/accounts") || p.startsWith("/accounts") },
  { href: "/settings/categories", label: "Categories", Icon: UI.Tags, match: (p: string) => p.startsWith("/settings/categories") },
  { href: "/settings", label: "Settings", Icon: UI.Settings, match: (p: string) => p === "/settings" || (p.startsWith("/settings/") && !p.startsWith("/settings/accounts") && !p.startsWith("/settings/categories")) },
];

/** WEB-01/02: the desktop navigation (≥1024px) with a persistent "Add transaction" button (shortcut N). */
export function Sidebar() {
  const pathname = usePathname();
  const { open } = useQuickAdd();
  return (
    <aside className="sidebar" aria-label="Sidebar" style={{ position: "fixed", inset: "0 auto 0 0", width: 248, padding: "28px 20px", flexDirection: "column", gap: 4, borderRight: "1px solid var(--rule)", background: "var(--bg)", zIndex: 10 }}>
      <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.03em", padding: "0 12px 24px" }}>{APP_NAME}</div>
      <nav aria-label="Main" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 12, height: 40, padding: "0 12px", borderRadius: 10, fontSize: 15, fontWeight: 500,
                background: active ? "var(--surface)" : undefined, color: active ? "var(--ink)" : "var(--ink-2)", boxShadow: active ? "inset 0 0 0 1px var(--rule)" : undefined }}>
              <Icon size={20} strokeWidth={1.75} aria-hidden />{label}
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: "auto" }}>
        <button className="btn" style={{ height: 44, fontSize: 15, borderRadius: 12 }} onClick={() => open()}>
          <UI.Plus size={18} strokeWidth={2.25} aria-hidden />Add transaction
          <kbd style={{ marginLeft: 6, font: "inherit", fontSize: 12, opacity: 0.6, padding: "1px 6px", borderRadius: 5, boxShadow: "inset 0 0 0 1px currentColor" }}>N</kbd>
        </button>
      </div>
    </aside>
  );
}
