import type { Page } from "@playwright/test";

export interface Touching { a: string; b: string; gap: number }

/**
 * Cards that touch or overlap. A "card" is anything that paints its own surface (opaque background that is not the page's, rounded
 * corners of 10px or more, at least 200px wide). Two cards that are side by side in the same column must have a gap, so this
 * lists every pair that is stacked with less than `min` px between them. Cards nested inside one another are not pairs.
 */
export async function touchingCards(page: Page, min = 6): Promise<Touching[]> {
  return page.evaluate((minGap) => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const label = (e: Element) => {
      const t = e.getAttribute("data-testid");
      const c = (e.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      const h = e.querySelector("h1,h2,h3,.headline,.eyebrow,b")?.textContent?.trim().slice(0, 28);
      return `${e.tagName.toLowerCase()}${t ? `[${t}]` : ""}${c ? `.${c}` : ""}${h ? ` “${h}”` : ""}`;
    };
    const cards: { el: Element; r: DOMRect }[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".tabbar, .sidebar, [data-vaul-overlay], [role=status], .toast")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.5) continue;
      // pinned footers and bars float over the content by design (their clearance is tested separately)
      let pinned = false;
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) { const pos = getComputedStyle(a).position; if (pos === "fixed" || pos === "sticky") { pinned = true; break; } }
      if (pinned) continue;
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      if (!m) continue;
      const parts = m[1]!.split(",").map((x) => parseFloat(x));
      if ((parts[3] ?? 1) < 0.9 || cs.backgroundColor === bg) continue;
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const r = el.getBoundingClientRect();
      if (radius < 10 || r.width < 200 || r.height < 24) continue;
      cards.push({ el, r });
    }
    const out: { a: string; b: string; gap: number }[] = [];
    for (let i = 0; i < cards.length; i++) for (let j = 0; j < cards.length; j++) {
      if (i === j) continue;
      const A = cards[i]!, B = cards[j]!;
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const overlapX = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      if (overlapX < Math.min(A.r.width, B.r.width) * 0.5) continue;
      const gap = B.r.top - A.r.bottom;                 // B is below A
      if (gap < minGap && gap > -A.r.height * 0.5 && B.r.top >= A.r.top) out.push({ a: label(A.el), b: label(B.el), gap: Math.round(gap * 10) / 10 });
    }
    return out;
  }, min);
}

/** Fails with the pairs listed, so a report names the two cards rather than saying "expected 0". */
export async function expectNoTouchingCards(page: Page, where: string, expectFn: (v: unknown, msg?: string) => { toEqual(x: unknown): void }) {
  const t = await touchingCards(page);
  expectFn(t, `${where}: cards with less than 6px between them`).toEqual([]);
}

/**
 * Nothing is wider than the screen. One element with text that cannot wrap makes the whole page wider than the phone, and the phone then
 * zooms out and shifts everything (the tab bar slides off to one side). Reports the elements that stick out.
 */
export async function expectNoSidewaysOverflow(page: Page, where: string, expectFn: (v: unknown, msg?: string) => { toEqual(x: unknown): void }) {
  const out = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => !e.closest(".tabbar, .sidebar, [data-vaul-overlay], [role=status], .toast") && getComputedStyle(e).position !== "fixed" && e.getBoundingClientRect().right > cw + 1 && e.getBoundingClientRect().width > 0)
      .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? `[${e.getAttribute("data-testid")}]` : ""}.${(e.getAttribute("class") ?? "").split(" ")[0]} right=${Math.round(e.getBoundingClientRect().right)} (screen ${cw})`);
    return { over: document.documentElement.scrollWidth - cw, wide };
  });
  expectFn(out.over > 1 ? out : { over: 0, wide: [] }, `${where}: wider than the screen`).toEqual({ over: 0, wide: [] });
}
