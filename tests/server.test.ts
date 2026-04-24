import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { NotFoundError } from "../src/errors.js";
import { type Context } from "../src/middleware.js";

test("Server - 70. app.listen() starts server and accepts connections", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.send("ok"));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 200);
  } finally {
    await app.close();
  }
});

test("Server - 71. app.close() stops accepting new connections", async () => {
  const app = new Velo();
  await app.listen(0);
  const port = app.port;
  await app.close();
  await assert.rejects(fetch(`http://localhost:${port}/`));
});

test("Server - 72. Unhandled route returns 404 via app.notFound handler", async () => {
  const app = new Velo();
  app.notFound((ctx: Context) => ctx.res.status(404).send("not found custom"));
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/unknown`);
    assert.strictEqual(await res.text(), "not found custom");
  } finally {
    await app.close();
  }
});

test("Server - 73. Throwing NotFoundError routes to error handler not notFound", async () => {
  const app = new Velo();
  let errCalled = false;
  app.onError((err: Error, ctx: Context) => {
    errCalled = true;
    ctx.res.status(404).send("error handler");
  });
  app.get("/throw", () => { throw new NotFoundError(); });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/throw`);
    assert.strictEqual(await res.text(), "error handler");
    assert.strictEqual(errCalled, true);
  } finally {
    await app.close();
  }
});

test("Server - 74. VeloError subclass thrown in handler responds with correct status", async () => {
  const app = new Velo();
  app.get("/429", async (ctx: Context) => {
    const { TooManyRequestsError } = await import("../src/errors.js");
    throw new TooManyRequestsError("Too fast");
  });
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/429`);
    assert.strictEqual(res.status, 429);
    const data = await res.json();
    assert.strictEqual(data.error, "Too fast");
  } finally {
    await app.close();
  }
});

test("Server - 75. Graceful shutdown waits for in-flight request to complete", async () => {
  const app = new Velo();
  let completed = false;
  app.get("/slow", async (ctx: Context) => {
    await new Promise(r => setTimeout(r, 100));
    completed = true;
    ctx.res.send("done");
  });
  await app.listen(0);
  const port = app.port;
  
  const fetchPromise = fetch(`http://localhost:${port}/slow`);
  
  // Wait a bit and then close
  await new Promise(r => setTimeout(r, 20));
  const closePromise = app.close();
  
  const [res] = await Promise.all([fetchPromise, closePromise]);
  assert.strictEqual(await res.text(), "done");
  assert.strictEqual(completed, true);
});
