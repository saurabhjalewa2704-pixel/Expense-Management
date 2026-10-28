// Local stand-in for the Supabase gateway: /rest/v1 -> PostgREST, /auth/v1 -> a minimal GoTrue.
// Test tooling only. It implements exactly what @supabase/supabase-js + @supabase/ssr call:
// email OTP, verify, user, refresh, logout, and admin create/list users.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const PGRST = new URL(process.env.PGRST_URL ?? "http://127.0.0.1:54323");
const SECRET = process.env.JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const OTP = process.env.FAKE_OTP ?? "123456";
const ALLOW_SIGNUPS = process.env.ALLOW_SIGNUPS === "true";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54322/sterling_dev", max: 4 });
const SEED_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../supabase/seed.sql");
const TRIP_SEED_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../supabase/seed_trip.sql");

const b64 = (b) => Buffer.from(b).toString("base64url");
function sign(claims) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify(claims));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = String(token ?? "").split(".");
  if (!h || !p || !s) return null;
  const good = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (good.length !== s.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const anonKey = sign({ role: "anon", iss: "supabase-local", exp: 4102444800 });
const serviceKey = sign({ role: "service_role", iss: "supabase-local", exp: 4102444800 });

const codes = new Map();
const userJson = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at,
  phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {},
  identities: [], created_at: u.created_at, updated_at: u.created_at, last_sign_in_at: new Date().toISOString(),
});
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  const access = sign({ aud: "authenticated", role: "authenticated", sub: u.id, email: u.email, iat: now, exp: now + 3600, session_id: sid, aal: "aal1", amr: [{ method: "otp", timestamp: now }] });
  const refresh = sign({ typ: "refresh", sub: u.id, iat: now, exp: now + 60 * 60 * 24 * 90, jti: crypto.randomUUID() });
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}
const findUser = async (by, v) => (await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users where ${by} = $1`, [v])).rows[0];
const createUser = async (email, meta = {}) =>
  (await pool.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, email, raw_user_meta_data, created_at`, [email, meta])).rows[0];

const readBody = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
const gotrueError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

// every existing user signs in with this password in tests (the real Supabase checks the stored hash)
const TEST_PASSWORD = "test-password-123";

async function auth(req, res, url) {
  const route = url.pathname.replace("/auth/v1", "");
  const body = ["POST", "PUT"].includes(req.method) ? JSON.parse((await readBody(req)).toString() || "{}") : {};
  if (route === "/otp" && req.method === "POST") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return gotrueError(res, 400, "validation_failed", "email required");
    const u = await findUser("email", email);
    if (!u && !(ALLOW_SIGNUPS && body.create_user !== false)) return gotrueError(res, 422, "otp_disabled", "Signups not allowed for otp");
    codes.set(email, { code: OTP, exp: Date.now() + 3600_000 });
    return send(res, 200, {});
  }
  if (route === "/verify" && req.method === "POST") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const c = codes.get(email);
    if (!c || c.code !== String(body.token) || c.exp < Date.now()) return gotrueError(res, 403, "otp_expired", "Token has expired or is invalid");
    codes.delete(email);
    const u = await findUser("email", email);
    if (!u) return gotrueError(res, 403, "otp_expired", "Token has expired or is invalid");
    return send(res, 200, session(u));
  }
  if (route === "/user" && req.method === "GET") {
    const claims = verify(bearer(req));
    if (!claims?.sub) return gotrueError(res, 401, "bad_jwt", "invalid JWT");
    const u = await findUser("id", claims.sub);
    if (!u) return gotrueError(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
    return send(res, 200, userJson(u));
  }
  if (route === "/token" && req.method === "POST" && url.searchParams.get("grant_type") === "password") {
    const u = await findUser("email", String(body.email ?? "").trim().toLowerCase());
    if (!u || body.password !== TEST_PASSWORD) return gotrueError(res, 400, "invalid_credentials", "Invalid login credentials");
    return send(res, 200, session(u));
  }
  if (route === "/token" && req.method === "POST" && url.searchParams.get("grant_type") === "refresh_token") {
    const claims = verify(body.refresh_token);
    if (claims?.typ !== "refresh") return gotrueError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    const u = await findUser("id", claims.sub);
    if (!u) return gotrueError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    return send(res, 200, session(u));
  }
  if (route === "/logout") return send(res, 204);
  if (route.startsWith("/admin/users")) {
    if (verify(bearer(req))?.role !== "service_role") return gotrueError(res, 403, "not_admin", "User not allowed");
    if (req.method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (await findUser("email", email)) return gotrueError(res, 422, "email_exists", "A user with this email address has already been registered");
      return send(res, 200, userJson(await createUser(email, body.user_metadata ?? {})));
    }
    if (req.method === "GET") {
      const rows = (await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users order by created_at`)).rows;
      return send(res, 200, { users: rows.map(userJson), aud: "authenticated" });
    }
  }
  return gotrueError(res, 404, "not_found", `no such route ${req.method} ${route}`);
}

// Test hooks. POST /__test/reset wipes every user (cascading), creates the owner, and can load the demo data.
//   ?seed=demo      run supabase/seed.sql for the owner
//   ?seed=trip      run supabase/seed_trip.sql (the USA trip) for the owner
//   ?onboarded=1    mark first-run setup as done
//   ?user=none      leave the database without any user
async function testHook(req, res, url) {
  if (url.pathname === "/__test/reset") {
    await pool.query("truncate auth.users cascade");
    const email = (process.env.ALLOWED_EMAIL ?? "owner@sterling.local").toLowerCase();
    let user = null;
    if (url.searchParams.get("user") !== "none") user = await createUser(email, { display_name: "Saurabh" });
    if (url.searchParams.get("seed") === "demo") {
      await pool.query(fs.readFileSync(SEED_FILE, "utf8"));
    } else if (url.searchParams.get("seed") === "trip") {
      await pool.query(fs.readFileSync(TRIP_SEED_FILE, "utf8"));       // PRD Appendix A.2, the USA trip, viewed on 12 March 2027
    } else if (user && url.searchParams.get("onboarded") === "1") {
      await pool.query("update profiles set onboarded_at = now() where id = $1", [user.id]);
    }
    return send(res, 200, { ok: true, user_id: user?.id ?? null });
  }
  return send(res, 404, { error: "no such hook" });
}

function proxy(req, res, url) {
  const headers = { ...req.headers, host: PGRST.host };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const upstream = http.request({ host: PGRST.hostname, port: PGRST.port, method: req.method, path: url.pathname.replace("/rest/v1", "") + url.search, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, "access-control-allow-origin": "*" });
    r.pipe(res);
  });
  upstream.on("error", (e) => send(res, 502, { message: String(e) }));
  req.pipe(upstream);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") return send(res, 204, undefined, { "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
    if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, url);
    if (url.pathname.startsWith("/__test/")) return await testHook(req, res, url);
    if (url.pathname === "/__keys") return send(res, 200, { anonKey, serviceKey });
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: String(e?.message ?? e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`gateway on :${PORT}`));
