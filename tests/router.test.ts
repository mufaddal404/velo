import { test } from "node:test";
import assert from "node:assert";
import { Router } from "../src/router.js";
import { Velo } from "../src/server.js";

test("Router - 1. Static route matches exactly", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users", [handler]);
  const { result } = router.match("GET", "/users");
  assert.strictEqual(result?.handlers[0], handler);
});

test("Router - 2. Named param extracted correctly", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users/:id", [handler]);
  const { result } = router.match("GET", "/users/42");
  assert.strictEqual(result?.params.id, "42");
});

test("Router - 3. Two params in one route both extracted", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users/:id/posts/:postId", [handler]);
  const { result } = router.match("GET", "/users/42/posts/100");
  assert.strictEqual(result?.params.id, "42");
  assert.strictEqual(result?.params.postId, "100");
});

test("Router - 4. Wildcard captures remainder including slashes", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/files/*", [handler]);
  const { result } = router.match("GET", "/files/a/b/c");
  assert.strictEqual(result?.params["*"], "a/b/c");
});

test("Router - 5. Static segment beats param for identical path", () => {
  const router = new Router();
  const h1 = () => {};
  const h2 = () => {};
  router.add("GET", "/users/:id", [h1]);
  router.add("GET", "/users/me", [h2]);
  const { result } = router.match("GET", "/users/me");
  assert.strictEqual(result?.handlers[0], h2);
});

test("Router - 6. Group prefix is prepended to all routes in the group", async () => {
  const app = new Velo();
  const api = app.group("/api/v1");
  const handler = () => {};
  api.get("/users", handler);
  
  // We check the internal router of the app
  const { result } = (app as any).router.match("GET", "/api/v1/users");
  assert.ok(result);
});

test("Router - 7. app.all() matches GET, POST, DELETE for the same path", async () => {
  const app = new Velo();
  const handler = () => {};
  app.all("/all", handler);
  
  assert.ok((app as any).router.match("GET", "/all").result);
  assert.ok((app as any).router.match("POST", "/all").result);
  assert.ok((app as any).router.match("DELETE", "/all").result);
});

test("Router - 8. Unknown path returns 404", async () => {
  const app = new Velo();
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/unknown`);
    assert.strictEqual(res.status, 404);
  } finally {
    await app.close();
  }
});

test("Router - 9. Known path with wrong method returns 405", async () => {
  const app = new Velo();
  app.get("/users", () => {});
  await app.listen(0);
  const port = (app as any).server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/users`, { method: "POST" });
    assert.strictEqual(res.status, 405);
  } finally {
    await app.close();
  }
});
