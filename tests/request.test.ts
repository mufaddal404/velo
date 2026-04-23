import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";

test("Request - Query string parsed including multi-value keys", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    assert.deepStrictEqual(ctx.req.query.a, ["1", "2"]);
    ctx.res.send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test?a=1&a=2`);
  await app.close();
});

test("Request - header() lookup is case-insensitive", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    assert.strictEqual(ctx.req.header("X-Custom"), "Value");
    assert.strictEqual(ctx.req.header("x-custom"), "Value");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`, {
    headers: { "X-Custom": "Value" }
  });
  await app.close();
});

test("Request - json() parses valid JSON body", async () => {
  const app = new Velo();
  app.post("/test", async (ctx: Context) => {
    const body = await ctx.req.json();
    assert.deepStrictEqual(body, { foo: "bar" });
    ctx.res.send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foo: "bar" })
  });
  await app.close();
});

test("Request - Body larger than bodyLimit rejects", async () => {
  const app = new Velo({ bodyLimit: 10 });
  app.post("/test", async (ctx: Context) => {
    try {
      await ctx.req.text();
      ctx.res.send("ok");
    } catch (e: any) {
      ctx.res.status(413).send(e.code);
    }
  });
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`, {
    method: "POST",
    body: "this is a very long body"
  });
  assert.strictEqual(res.status, 413);
  await app.close();
});

test("Request - cookies parsed correctly", async () => {
  const app = new Velo();
  app.get("/test", (ctx: Context) => {
    assert.strictEqual(ctx.req.cookies.foo, "bar");
    assert.strictEqual(ctx.req.cookies.baz, "qux");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`, {
    headers: { "Cookie": "foo=bar; baz=qux" }
  });
  await app.close();
});

test("Request - ip reflects X-Forwarded-For when trustProxy is true", async () => {
  const app = new Velo({ trustProxy: true });
  app.get("/test", (ctx: Context) => {
    assert.strictEqual(ctx.req.ip, "1.2.3.4");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`, {
    headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" }
  });
  await app.close();
});
