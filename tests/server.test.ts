import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { ForbiddenError } from "../src/errors.js";

test("Server - app.listen() and app.close()", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.send("ok"));
  await app.listen(0);
  const address = (app as any).server.address();
  const res = await fetch(`http://localhost:${address.port}/`);
  assert.strictEqual(res.status, 200);
  await app.close();
});

test("Server - Unhandled route returns 404", async () => {
  const app = new Velo();
  await app.listen(0);
  const address = (app as any).server.address();
  try {
    const res = await fetch(`http://localhost:${address.port}/not-found`);
    assert.strictEqual(res.status, 404);
  } finally {
    await app.close();
  }
});

test("Server - VeloError responds with correct status", async () => {
  const app = new Velo();
  app.get("/forbidden", () => {
    throw new ForbiddenError("No entry");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  try {
    const res = await fetch(`http://localhost:${address.port}/forbidden`);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.error, "No entry");
  } finally {
    await app.close();
  }
});

test("Server - custom notFound handler", async () => {
  const app = new Velo();
  app.notFound((ctx: Context) => {
    ctx.res.status(404).send("custom not found");
  });
  await app.listen(0);
  const address = (app as any).server.address();
  try {
    const res = await fetch(`http://localhost:${address.port}/anything`);
    assert.strictEqual(await res.text(), "custom not found");
  } finally {
    await app.close();
  }
});
