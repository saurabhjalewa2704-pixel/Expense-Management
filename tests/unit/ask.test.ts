import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskModel, AskStep, Block, Msg, ToolFact } from "@/lib/ai/ask/types";

const runToolMock = vi.fn();
vi.mock("@/lib/ai/ask/tools", () => ({ TOOL_DEFS: [], runTool: (...a: unknown[]) => runToolMock(...a) }));

import { answerQuestion } from "@/lib/ai/ask/run";
import { fallbackAnswer, validateAnswer } from "@/lib/ai/ask/validate";

const F: ToolFact[] = [{ label: "Eating out, September", display: "£312.60" }, { label: "Change", display: "38%" }, { label: "Big", display: "£1,812.40" }];
const ctx = { db: {} as never, today: "2026-10-18", categories: [] };
const text = (t: string): Block[] => [{ type: "text", text: t }];
const tool = (name = "spend_summary"): Block[] => [{ type: "tool_use", id: `t${Math.random()}`, name, input: {} }];
const step = (content: Block[]): AskStep => ({ content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", inputTokens: 10, outputTokens: 5 });
const scripted = (steps: AskStep[], seen: Msg[][] = []): AskModel => { let i = 0; return { id: "fake", async step(input) { seen.push(JSON.parse(JSON.stringify(input.messages))); return steps[Math.min(i++, steps.length - 1)]!; } }; };
const run = (model: AskModel, history = [] as { question: string; answer: string; facts: ToolFact[] }[]) => answerQuestion({ model, ctx, pots: [], includeNotes: false, question: "How much did I spend on eating out?", history });

beforeEach(() => { runToolMock.mockReset(); runToolMock.mockResolvedValue({ facts: F }); });

describe("validateAnswer", () => {
  it("accepts figures the tools returned, exactly", () => expect(validateAnswer("You spent £312.60, up 38%. The biggest was £1,812.40.", F)).toEqual({ ok: true, bad: [] }));
  it("rejects a figure no tool returned, including a rounded one", () => {
    expect(validateAnswer("You spent about £313.", F)).toEqual({ ok: false, bad: ["£313"] });
    expect(validateAnswer("Up 40%.", F).bad).toEqual(["40%"]);
  });
  it("does not mistake a trailing comma for part of an amount", () => expect(validateAnswer("£312.60, then 38%.", F).ok).toBe(true));
  it("rejects an empty answer and accepts one with no figures", () => {
    expect(validateAnswer("  ", F).ok).toBe(false);
    expect(validateAnswer("Nothing unusual in September.", F).ok).toBe(true);
  });
});

describe("fallbackAnswer", () => {
  it("lists labelled figures, once each, at most ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ label: `Item ${i}`, display: `£${i}.00` }));
    const out = fallbackAnswer([...many, many[0]!]);
    expect(out.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(10);
    expect(out).toContain("• Item 0: £0.00");
  });
  it("says so when there is nothing to show", () => expect(fallbackAnswer([])).toContain("couldn't find anything"));
});

describe("answerQuestion", () => {
  it("runs the tool, accepts a grounded answer and totals the tokens", async () => {
    const r = await run(scripted([step(tool()), step(text("You spent £312.60 on eating out, 38% above usual."))]));
    expect(r).toMatchObject({ answer: "You spent £312.60 on eating out, 38% above usual.", usedFallback: false, toolCalls: ["spend_summary"], inputTokens: 20, outputTokens: 10, model: "fake" });
    expect(r.facts).toEqual(F);
  });

  it("gives an ungrounded answer one retry with the offending figure named", async () => {
    const seen: Msg[][] = [];
    const r = await run(scripted([step(tool()), step(text("You spent £999.")), step(text("You spent £312.60."))], seen));
    expect(r).toMatchObject({ answer: "You spent £312.60.", usedFallback: false });
    const retry = seen[seen.length - 1]!.at(-1)!;
    expect(retry.role).toBe("user");
    expect(retry.content).toContain('"£999"');
  });

  it("falls back to the figures themselves when the retry is ungrounded too", async () => {
    const r = await run(scripted([step(tool()), step(text("£999")), step(text("£998"))]));
    expect(r.usedFallback).toBe(true);
    expect(r.answer).toContain("• Eating out, September: £312.60");
    expect(r.answer).not.toContain("£999");
  });

  it("feeds a tool error back to the model, which can recover", async () => {
    runToolMock.mockRejectedValueOnce(new Error("unknown category_id")).mockResolvedValue({ facts: F });
    const seen: Msg[][] = [];
    const r = await run(scripted([step(tool()), step(tool()), step(text("£312.60 it was."))], seen));
    expect(r.usedFallback).toBe(false);
    const errBlock = (seen[1]!.at(-1)!.content as Block[])[0]!;
    expect(errBlock).toMatchObject({ type: "tool_result", is_error: true });
  });

  it("lets a follow-up quote a figure from the previous turn", async () => {
    const history = [{ question: "Eating out in September?", answer: "£312.60.", facts: F }];
    const r = await run(scripted([step(text("As before, £312.60."))]), history);
    expect(r.usedFallback).toBe(false);
    expect(r.toolCalls).toEqual([]);
  });

  it("gives up cleanly if the model never stops calling tools", async () => {
    const r = await run(scripted([step(tool())]));
    expect(r.usedFallback).toBe(true);
    expect(r.toolCalls.length).toBe(6);
    expect(r.answer).toContain("£312.60");
  });

  it("never invents numbers in the fallback when no tool returned anything", async () => {
    runToolMock.mockResolvedValue({ facts: [] });
    const r = await run(scripted([step(tool()), step(text("£5")), step(text("£6"))]));
    expect(r.answer).toContain("couldn't find anything");
    expect(r.answer).not.toMatch(/£\d/);
  });
});
