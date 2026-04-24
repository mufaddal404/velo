import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";

test("Request - 17. Query string parsed including multi-value keys", async () => {
  const app = new Velo();
  let query: any = null;
  app.get("/", (ctx: any) => {
    query = ctx.req.query;
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/?a=1&a=2&b=3`);
    assert.deepStrictEqual(query.a, ["1", "2"]);
    assert.strictEqual(query.b, "3");
  } finally {
    await app.close();
  }
});

test("Request - 18. header() lookup is case-insensitive", async () => {
  const app = new Velo();
  let header: string | undefined;
  app.get("/", (ctx: any) => {
    header = ctx.req.header("X-Custom-Header");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`, {
      headers: { "x-custom-header": "value" }
    });
    assert.strictEqual(header, "value");
  } finally {
    await app.close();
  }
});

test("Request - 19. json() parses valid JSON body", async () => {
  const app = new Velo();
  let body: any = null;
  app.post("/", async (ctx: any) => {
    body = await ctx.req.json();
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" })
    });
    assert.deepStrictEqual(body, { hello: "world" });
  } finally {
    await app.close();
  }
});

test("Request - 20. json() rejects on non-JSON content-type", async () => {
  const app = new Velo();
  app.post("/", async (ctx: any) => {
    try {
      await ctx.req.json();
      ctx.res.send("ok");
    } catch (e: any) {
      ctx.res.status(400).send(e.message);
    }
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"a":1}'
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await app.close();
  }
});

test("Request - 21. Body larger than bodyLimit rejects with PayloadTooLargeError", async () => {
  const app = new Velo({ bodyLimit: 10 });
  app.post("/", async (ctx: any) => {
    try {
      await ctx.req.json();
      ctx.res.send("ok");
    } catch (e: any) {
      ctx.res.status(413).send(e.message);
    }
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tooLong: "yes indeed" })
    });
    assert.strictEqual(res.status, 413);
  } finally {
    await app.close();
  }
});

test("Request - 22. Calling json() twice throws BodyAlreadyConsumedError", async () => {
  const app = new Velo();
  app.post("/", async (ctx: any) => {
    await ctx.req.json();
    try {
      await ctx.req.json();
      ctx.res.send("ok");
    } catch (e: any) {
      ctx.res.status(500).send(e.name);
    }
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 })
    });
    const text = await res.text();
    assert.strictEqual(text, "BodyAlreadyConsumedError");
  } finally {
    await app.close();
  }
});

test("Request - 23. cookies parsed correctly from Cookie header", async () => {
  const app = new Velo();
  let cookies: any = null;
  app.get("/", (ctx: any) => {
    cookies = ctx.req.cookies;
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`, {
      headers: { "Cookie": "session=123; user=me" }
    });
    assert.deepStrictEqual(cookies, { session: "123", user: "me" });
  } finally {
    await app.close();
  }
});

test("Request - 24. ip reflects X-Forwarded-For when trustProxy: true", async () => {
  const app = new Velo({ trustProxy: true });
  let ip: string = "";
  app.get("/", (ctx: any) => {
    ip = ctx.req.ip;
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`, {
      headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" }
    });
    assert.strictEqual(ip, "1.2.3.4");
  } finally {
    await app.close();
  }
});

test("Request - 25. ip ignores X-Forwarded-For when trustProxy: false", async () => {
  const app = new Velo({ trustProxy: false });
  let ip: string = "";
  app.get("/", (ctx: any) => {
    ip = ctx.req.ip;
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`, {
      headers: { "X-Forwarded-For": "1.2.3.4" }
    });
    assert.notStrictEqual(ip, "1.2.3.4");
  } finally {
    await app.close();
  }
});
