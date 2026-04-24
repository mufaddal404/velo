import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { Readable } from "node:stream";
import { type Context } from "../src/middleware.js";

test("Response - 26. send(object) sets Content-Type: application/json", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.send({ a: 1 }));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.headers.get("content-type"), "application/json");
    assert.deepStrictEqual(await res.json(), { a: 1 });
  } finally {
    await app.close();
  }
});

test("Response - 27. send(string) sets Content-Type: text/plain", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.send("hello"));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.headers.get("content-type"), "text/plain");
    assert.strictEqual(await res.text(), "hello");
  } finally {
    await app.close();
  }
});

test("Response - 28. status(201).json(data) sends correct status and body", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.status(201).json({ created: true }));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(await res.json(), { created: true });
  } finally {
    await app.close();
  }
});

test("Response - 29. redirect() sends 302 and Location header", async () => {
  const app = new Velo();
  app.get("/old", (ctx: Context) => ctx.res.redirect("/new"));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/old`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/new");
  } finally {
    await app.close();
  }
});

test("Response - 30. cookie() sets Set-Cookie header with correct attributes", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => {
    ctx.res.cookie("test", "val", { httpOnly: true, secure: true });
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    const cookie = res.headers.get("set-cookie");
    assert.ok(cookie?.includes("test=val"));
    assert.ok(cookie?.includes("HttpOnly"));
    assert.ok(cookie?.includes("Secure"));
  } finally {
    await app.close();
  }
});

test("Response - 31. clearCookie() sets cookie with Max-Age=0", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => {
    ctx.res.clearCookie("test");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    const cookie = res.headers.get("set-cookie");
    assert.ok(cookie?.includes("Max-Age=0"));
  } finally {
    await app.close();
  }
});

test("Response - 32. Calling send() after sent === true throws ResponseAlreadySentError", async () => {
  // Let's test the response object directly.
  const { Response } = await import("../src/response.js");
  const mockRes: any = { end: () => {}, setHeader: () => {}, getHeader: () => {} };
  const res = new Response(mockRes);
  res.send("ok");
  assert.throws(() => res.send("again"), /ResponseAlreadySentError/);
});

test("Response - 33. stream() pipes readable to response", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => {
    const s = new Readable();
    s.push("streamed content");
    s.push(null);
    ctx.res.stream(s);
  });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(await res.text(), "streamed content");
  } finally {
    await app.close();
  }
});

test("Response - Cookie injection escaping", async () => {
  const app = new Velo();
  app.get("/cookie", (ctx: Context) => {
    ctx.res.cookie("session", "val; Domain=evil.com");
    ctx.res.send("ok");
  });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/cookie`);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies[0].startsWith("session=val%3B%20Domain%3Devil.com"));
  } finally {
    await app.close();
  }
});
