import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { Readable } from "node:stream";

test("Response - send(object) sets Content-Type: application/json", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.send({ hello: "world" });
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  assert.strictEqual(res.headers.get("content-type"), "application/json");
  const data = await res.json();
  assert.deepStrictEqual(data, { hello: "world" });
  await app.close();
});

test("Response - status(201).json(data) sends correct status and body", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.status(201).json({ created: true });
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.deepStrictEqual(data, { created: true });
  await app.close();
});

test("Response - redirect() sends 302 and Location header", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.redirect("/new-place");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`, { redirect: "manual" });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get("location"), "/new-place");
  await app.close();
});

test("Response - cookie() sets Set-Cookie header", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.cookie("session", "123", { httpOnly: true }).send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie?.includes("session=123"));
  assert.ok(cookie?.includes("HttpOnly"));
  await app.close();
});

test("Response - send(string) sets Content-Type: text/plain", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.send("hello");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  assert.strictEqual(res.headers.get("content-type"), "text/plain");
  assert.strictEqual(await res.text(), "hello");
  await app.close();
});

test("Response - clearCookie() sets cookie with Max-Age=0", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    ctx.res.clearCookie("session").send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie?.includes("session="));
  assert.ok(cookie?.includes("Max-Age=0"));
  await app.close();
});

test("Response - calling send() twice throws ResponseAlreadySentError", async () => {
  const app = new Velo();
  let caught = false;
  app.get("/test", (ctx: Context) => {
    ctx.res.send("first");
    try {
      ctx.res.send("second");
    } catch (e: any) {
      caught = true;
    }
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`);
  assert.strictEqual(caught, true);
  await app.close();
});

test("Response - stream() pipes readable to response", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    const stream = Readable.from(["hello", " ", "world"]);
    ctx.res.stream(stream);
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  const text = await res.text();
  assert.strictEqual(text, "hello world");
  await app.close();
});
