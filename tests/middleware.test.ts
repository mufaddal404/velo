import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { type Context } from "../src/middleware.js";

test("Middleware - 10. Global middleware runs before every handler", async () => {
  const app = new Velo();
  let mwCalled = false;
  app.use(async (ctx, next) => {
    mwCalled = true;
    await next();
  });
  app.get("/", (ctx: any) => ctx.res.send("ok"));
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`);
    assert.strictEqual(mwCalled, true);
  } finally {
    await app.close();
  }
});

test("Middleware - 11. Prefix-scoped middleware only runs for matching paths", async () => {
  const app = new Velo();
  let mwCalled = 0;
  app.use("/admin", async (ctx, next) => {
    mwCalled++;
    await next();
  });
  app.get("/admin/panel", (ctx: any) => ctx.res.send("ok"));
  app.get("/public", (ctx: any) => ctx.res.send("ok"));
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/public`);
    assert.strictEqual(mwCalled, 0);
    await fetch(`http://localhost:${port}/admin/panel`);
    assert.strictEqual(mwCalled, 1);
  } finally {
    await app.close();
  }
});

test("Middleware - 12. Middleware that throws routes to error handler", async () => {
  const app = new Velo();
  app.use(async () => {
    throw new Error("MW Error");
  });
  let errorReceived: Error | null = null;
  app.onError((err, ctx) => {
    errorReceived = err;
    ctx.res.status(500).send("err");
  });
  app.get("/", (ctx: any) => ctx.res.send("ok"));
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`);
    assert.strictEqual((errorReceived as any)?.message, "MW Error");
  } finally {
    await app.close();
  }
});

test("Middleware - 13. Middleware that skips next() and skips send() triggers 500", async () => {
  const app = new Velo();
  app.use(async (ctx, next) => {
    // neither next() nor ctx.res.send()
  });
  app.get("/", (ctx: any) => ctx.res.send("ok"));
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 500);
  } finally {
    await app.close();
  }
});

test("Middleware - 14. Multiple middleware run in registration order", async () => {
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
  app.get("/", (ctx: any) => ctx.res.send("ok"));
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`);
    assert.deepStrictEqual(order, [1, 2]);
  } finally {
    await app.close();
  }
});

test("Middleware - 15. Route-level middleware runs after global middleware", async () => {
  const app = new Velo();
  const order: string[] = [];
  app.use(async (ctx, next) => {
    order.push("global");
    await next();
  });
  app.get("/", 
    async (ctx, next) => {
      order.push("route");
      await next();
    },
    (ctx: any) => ctx.res.send("ok")
  );
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`);
    assert.deepStrictEqual(order, ["global", "route"]);
  } finally {
    await app.close();
  }
});

test("Middleware - 16. Error handler receives the thrown error instance", async () => {
  const app = new Velo();
  const myError = new Error("Custom Error");
  app.get("/", () => {
    throw myError;
  });
  let received: any = null;
  app.onError((err, ctx) => {
    received = err;
    ctx.res.status(500).send("err");
  });
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    await fetch(`http://localhost:${port}/`);
    assert.strictEqual(received, myError);
  } finally {
    await app.close();
  }
});
