import http from "node:http";

/**
 * A pass-through in front of the app that can change the service worker script, to stage a "new build" without rebuilding.
 * (Playwright cannot intercept the browser's own service-worker update fetch, so the test talks to this proxy instead.)
 */
export function startUpdateProxy(target = `http://127.0.0.1:${process.env.E2E_PORT ?? "3200"}`, port = 3300) {
  let suffix = "";
  const t = new URL(target);
  const server = http.createServer((req, res) => {
    const up = http.request({ host: t.hostname, port: t.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      if (req.url?.split("?")[0] === "/serwist/sw.js" && suffix) {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => {
          const body = Buffer.concat([Buffer.concat(chunks), Buffer.from(`\n// ${suffix}\n`)]);
          const headers = { ...r.headers, "content-length": String(body.length) };
          delete headers["content-encoding"]; delete headers["transfer-encoding"];
          res.writeHead(r.statusCode ?? 200, headers); res.end(body);
        });
        return;
      }
      res.writeHead(r.statusCode ?? 200, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end("proxy error"); });
    req.pipe(up);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    setBuild: (s: string) => { suffix = s; },
    listen: () => new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok)),
    close: () => new Promise<void>((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
