"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuickAdd } from "@/components/capture/quick-add";
import { UI } from "@/lib/icons";

const TABS = [
  { href: "/", label: "Home", Icon: UI.House, match: (p: string) => p === "/" || p.startsWith("/cash") || p.startsWith("/settings") || p.startsWith("/accounts") || p.startsWith("/bills") },
  { href: "/activity", label: "Activity", Icon: UI.List, match: (p: string) => p.startsWith("/activity") },
  null,
  { href: "/analytics", label: "Analytics", Icon: UI.ChartNoAxesColumn, match: (p: string) => p.startsWith("/analytics") },
  { href: "/insights", label: "Insights", Icon: UI.Sparkles, match: (p: string) => p.startsWith("/insights") },
];

/** MOB-01/02: five slots, the raised centre disc opens Quick Add from any tab, safe-area aware. */
export function TabBar() {
  const pathname = usePathname();
  const { open } = useQuickAdd();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) =>
        t ? (
          <Link key={t.href} href={t.href} className={`tab ${t.match(pathname) ? "active" : ""}`} aria-current={t.match(pathname) ? "page" : undefined}>
            <t.Icon size={24} strokeWidth={t.match(pathname) ? 2 : 1.75} aria-hidden />
            <span>{t.label}</span>
          </Link>
        ) : (
          <button key="add" className="tab-add" aria-label="Add transaction" onClick={() => open()}>
            <UI.Plus size={24} strokeWidth={2.25} aria-hidden />
          </button>
        ),
      )}
    </nav>
  );
}
