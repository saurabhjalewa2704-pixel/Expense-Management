"use client";
import { useEffect, useState } from "react";

const seen = new Set<string>();

/** True the first time a keyed element mounts in this page session, false afterwards (entry-only animations that must not replay on every visit or refetch). */
export function useFirstPaint(key: string): boolean {
  const [first] = useState(() => !seen.has(key));
  useEffect(() => { seen.add(key); }, [key]);
  return first;
}
