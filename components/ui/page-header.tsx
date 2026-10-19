import Link from "next/link";
import type { ReactNode } from "react";
import { UI } from "@/lib/icons";

/** A back link (iOS navbar) and a large title. */
export function PageHeader({ title, back, backLabel, right }: { title: string; back?: string; backLabel?: string; right?: ReactNode }) {
  return (
    <>
      <div className="navbar" style={{ justifyContent: back ? "space-between" : "flex-end" }}>
        {back && <Link className="back" href={back}><UI.ChevronLeft size={22} strokeWidth={1.75} aria-hidden />{backLabel ?? "Back"}</Link>}
        {right}
      </div>
      <h1 className="large-title">{title}</h1>
    </>
  );
}
