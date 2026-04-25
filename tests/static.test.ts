import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { staticFiles } from "../src/static.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

const PUBLIC_DIR = "./tests/public";

test("Static - 43. Existing file served with correct Content-Type", async () => {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, "test.txt"), "hello static");
  
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/test.txt`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "hello static");
    assert.strictEqual(res.headers.get("content-type"), "text/plain");
  } finally {
    await app.close();
  }
});

test("Static - 44. Non-existent file returns 404", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/not-found.txt`);
    assert.strictEqual(res.status, 404);
  } finally {
    await app.close();
  }
});

test("Static - 45. Path with .. returns 403", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port!;
  try {
    const res = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request({
        port,
        hostname: "localhost",
        path: "/../package.json",
        method: "GET"
      }, resolve);
      req.end();
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("Static - 46. Dotfile with dotFiles: 'deny' returns 403", async () => {
  fs.writeFileSync(path.join(PUBLIC_DIR, ".secret"), "secret");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR, dotFiles: "deny" });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/.secret`);
    assert.strictEqual(res.status, 403);
  } finally {
    await app.close();
  }
});

test("Static - 47. Dotfile with dotFiles: 'ignore' returns 404", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR, dotFiles: "ignore" });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/.secret`);
    assert.strictEqual(res.status, 404);
  } finally {
    await app.close();
  }
});

test("Static - 48. Dotfile with dotFiles: 'allow' is served", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR, dotFiles: "allow" });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/.secret`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "secret");
  } finally {
    await app.close();
  }
});

test("Static - 49. ETag header present; second request with matching If-None-Match returns 304", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res1 = await fetch(`http://localhost:${port}/test.txt`);
    const etag = res1.headers.get("etag");
    assert.ok(etag);
    
    const res2 = await fetch(`http://localhost:${port}/test.txt`, {
      headers: { "If-None-Match": etag }
    });
    assert.strictEqual(res2.status, 304);
  } finally {
    await app.close();
  }
});

test("Static - 50. Range request returns 206 with correct byte slice", async () => {
  fs.writeFileSync(path.join(PUBLIC_DIR, "range.txt"), "0123456789");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/range.txt`, {
      headers: { "Range": "bytes=2-5" }
    });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(await res.text(), "2345");
  } finally {
    await app.close();
  }
});

test("Static - Range Suffix Support (bytes=-3)", async () => {
  fs.writeFileSync(path.join(PUBLIC_DIR, "suffix.txt"), "0123456789");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/suffix.txt`, {
      headers: { "Range": "bytes=-3" }
    });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(await res.text(), "789");
    assert.strictEqual(res.headers.get("content-range"), "bytes 7-9/10");
  } finally {
    await app.close();
  }
});

test("Static - Range Suffix Large (bytes=-999)", async () => {
  fs.writeFileSync(path.join(PUBLIC_DIR, "large-suffix.txt"), "abc");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/large-suffix.txt`, {
      headers: { "Range": "bytes=-999" }
    });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(await res.text(), "abc");
    assert.strictEqual(res.headers.get("content-range"), "bytes 0-2/3");
  } finally {
    await app.close();
  }
});

test("Static - Invalid Range", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res1 = await fetch(`http://localhost:${port}/range.txt`, {
      headers: { "Range": "bytes=abc-" }
    });
    assert.strictEqual(res1.status, 416);

    const res2 = await fetch(`http://localhost:${port}/range.txt`, {
      headers: { "Range": "bytes=-abc" }
    });
    assert.strictEqual(res2.status, 416);

    const res3 = await fetch(`http://localhost:${port}/range.txt`, {
      headers: { "Range": "bytes=10-5" }
    });
    assert.strictEqual(res3.status, 416);
  } finally {
    await app.close();
  }
});

test("Static - 51. Directory request with index file serves the index", async () => {
  fs.mkdirSync(path.join(PUBLIC_DIR, "dir"), { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, "dir", "index.html"), "index content");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/dir/`);
    assert.strictEqual(await res.text(), "index content");
  } finally {
    await app.close();
  }
});

test("Static - 52. prefix option restricts serving to that URL prefix", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR, prefix: "/static" });
  await app.listen(0);
  const port = app.port;
  try {
    const res1 = await fetch(`http://localhost:${port}/test.txt`);
    assert.strictEqual(res1.status, 404);
    const res2 = await fetch(`http://localhost:${port}/static/test.txt`);
    assert.strictEqual(res2.status, 200);
  } finally {
    await app.close();
  }
});

test("Static - URI Decoding", async () => {
  const reproDir = "./tests/public_repro";
  if (!fs.existsSync(reproDir)) fs.mkdirSync(reproDir, { recursive: true });
  fs.writeFileSync(path.join(reproDir, "space file.txt"), "space content");
  
  const app = new Velo();
  app.register(staticFiles, { root: reproDir });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/space%20file.txt`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "space content");
  } finally {
    await app.close();
  }
});

test("Static - Path Traversal with encoded characters", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port!;
  try {
    const res = await new Promise<http.IncomingMessage>((resolve) => {
      const req = http.request({
        port,
        hostname: "localhost",
        path: "/%2e%2e/package.json",
        method: "GET"
      }, resolve);
      req.end();
    });
    assert.strictEqual(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("Static - Multiple Ranges (multipart/byteranges)", async () => {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, "multi-range.txt"), "0123456789abcdefghij");
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/multi-range.txt`, {
      headers: { "Range": "bytes=0-1, 10-11, 18-19" }
    });
    assert.strictEqual(res.status, 206);
    const contentType = res.headers.get("content-type") || "";
    assert.ok(contentType.includes("multipart/byteranges"));
    
    const body = await res.text();
    assert.ok(body.includes("01"));
    assert.ok(body.includes("ab"));
    assert.ok(body.includes("ij"));
    assert.ok(body.includes("Content-Range: bytes 0-1/20"));
    assert.ok(body.includes("Content-Range: bytes 10-11/20"));
    assert.ok(body.includes("Content-Range: bytes 18-19/20"));
  } finally {
    await app.close();
  }
});

test("Static - Too many ranges rejected", async () => {
  const app = new Velo();
  app.register(staticFiles, { root: PUBLIC_DIR, maxRanges: 2 });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/multi-range.txt`, {
      headers: { "Range": "bytes=0-1, 5-6, 10-11" }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(await res.text(), "Too many ranges");
  } finally {
    await app.close();
  }
});
