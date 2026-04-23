import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";

test("Middleware - Global middleware runs before every handler", async () => {
  const app = new Velo();
  let count = 0;
  app.use(async (ctx, next) => {
    count++;
    await next();
  });
  app.get("/test", (ctx: Context) => {
    ctx.res.send("ok");
  });

  // We need a way to mock req/res or run the server
  // For now I'll use a real server on a random port
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  await res.text();
  assert.strictEqual(count, 1);
  await app.close();
});

test("Middleware - Prefix-scoped middleware only runs for matching paths", async () => {
  const app = new Velo();
  let count = 0;
  app.use("/admin", async (ctx, next) => {
    count++;
    await next();
  });
  app.get("/admin/panel", (ctx: Context) => ctx.res.send("ok"));
  app.get("/public", (ctx: Context) => ctx.res.send("ok"));

  await app.listen(0);
  const address = (app as any).server.address();
  
  await fetch(`http://localhost:${address.port}/admin/panel`);
  assert.strictEqual(count, 1);
  
  await fetch(`http://localhost:${address.port}/public`);
  assert.strictEqual(count, 1);
  
  await app.close();
});

test("Middleware - Execution order", async () => {
  const app = new Velo();
  const order: number[] = [];
  app.use(async (ctx, next) => {
    order.push(1);
    await next();
  });
  app.use(async (ctx, next) => {
    order.push(2);
    await next();
  });
  app.get("/test", (ctx: Context) => {
    order.push(3);
    ctx.res.send("ok");
  });

  await app.listen(0);
  const address = (app as any).server.address();
  await fetch(`http://localhost:${address.port}/test`);
  assert.deepStrictEqual(order, [1, 2, 3]);
  await app.close();
});

test("Middleware - Throwing routes to error handler", async () => {
  const app = new Velo();
  app.use(async () => {
    throw new Error("fail");
  });
  app.get("/test", (ctx: Context) => ctx.res.send("ok"));

  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/test`);
  const data = await res.json();
  assert.strictEqual(res.status, 500);
  assert.strictEqual(data.error, "Internal Server Error");
  await app.close();
});
