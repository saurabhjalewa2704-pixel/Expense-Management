import pg from "pg";

/** Direct access to the E2E database, to prove what is (and is not) stored. */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54322/sterling_dev" });
  await client.connect();
  try { return (await client.query(text, params)).rows as T[]; } finally { await client.end(); }
}

/** The first row, or an error: for queries that must return exactly one. */
export async function sqlOne<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params);
  if (!rows[0]) throw new Error(`no row for: ${text}`);
  return rows[0];
}
