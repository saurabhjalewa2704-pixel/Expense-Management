// The model-facing shapes for Ask Sterling, kept free of any SDK type so a test double can stand in for the real model.
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Msg { role: "user" | "assistant"; content: string | Block[] }
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

export interface AskStepInput { system: string; messages: Msg[]; tools: ToolDef[] }
export interface AskStep { content: Block[]; stopReason: string; inputTokens: number; outputTokens: number }
export interface AskModel { id: string; step(i: AskStepInput): Promise<AskStep> }

/** One figure a tool returned. `display` is the exact string the answer may quote. */
export interface ToolFact { label: string; display: string }
export interface ToolOutput { facts: ToolFact[]; note?: string }

export interface CatRow { id: string; name: string; parent_id: string | null; kind: "expense" | "income" }
