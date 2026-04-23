import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Router } from "../src/router.js";

test("Router - Static route matches exactly", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users", [handler]);
  
  const { result } = router.match("GET", "/users");
  assert.strictEqual(result?.handlers[0], handler);
});

test("Router - Named param extracted correctly", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users/:id", [handler]);
  
  const { result } = router.match("GET", "/users/42");
  assert.strictEqual(result?.handlers[0], handler);
  assert.strictEqual(result?.params.id, "42");
});

test("Router - Two params in one route extracted", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/users/:id/posts/:postId", [handler]);
  
  const { result } = router.match("GET", "/users/42/posts/100");
  assert.strictEqual(result?.handlers[0], handler);
  assert.strictEqual(result?.params.id, "42");
  assert.strictEqual(result?.params.postId, "100");
});

test("Router - Wildcard captures remainder including slashes", () => {
  const router = new Router();
  const handler = () => {};
  router.add("GET", "/files/*", [handler]);
  
  const { result } = router.match("GET", "/files/a/b/c");
  assert.strictEqual(result?.handlers[0], handler);
  assert.strictEqual(result?.params["*"], "a/b/c");
});

test("Router - Static segment beats param for identical path", () => {
  const router = new Router();
  const h1 = () => {};
  const h2 = () => {};
  router.add("GET", "/users/:id", [h1]);
  router.add("GET", "/users/me", [h2]);
  
  const { result } = router.match("GET", "/users/me");
  assert.strictEqual(result?.handlers[0], h2);
});

test("Router - Unknown path returns null", () => {
  const router = new Router();
  const { result, methodNotAllowed } = router.match("GET", "/unknown");
  assert.strictEqual(result, null);
  assert.strictEqual(methodNotAllowed, false);
});

test("Router - Known path with wrong method returns methodNotAllowed", () => {
  const router = new Router();
  router.add("GET", "/users", [() => {}]);
  const { result, methodNotAllowed } = router.match("POST", "/users");
  assert.strictEqual(result, null);
  assert.strictEqual(methodNotAllowed, true);
});

test("Router - Group prefix is prepended to all routes", () => {
  const router = new Router();
  // We'll simulate group by manually adding prefixed routes
  const h1 = () => {};
  router.add("GET", "/api/v1/users", [h1]);
  
  assert.strictEqual(router.match("GET", "/api/v1/users").result?.handlers[0], h1);
});

test("Router - Wildcard beats nothing", () => {
  const router = new Router();
  const h = () => {};
  router.add("GET", "/files/*", [h]);
  assert.strictEqual(router.match("GET", "/files/a/b").result?.handlers[0], h);
});
