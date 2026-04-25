import { test } from "node:test";
import assert from "node:assert";
import { v, validate } from "../src/validation.js";
import { Velo } from "../src/server.js";
import { type Context } from "../src/middleware.js";

test("Validation - 53. Valid object passes all constraints, returns typed data", () => {
  const schema = v.object({
    name: v.string().minLength(1),
    age: v.number().min(18)
  });
  const result = schema.parse({ name: "Alice", age: 25 });
  assert.strictEqual(result.success, true);
  if (result.success) {
    assert.strictEqual(result.data.name, "Alice");
    assert.strictEqual(result.data.age, 25);
  }
});

test("Validation - 54. Missing required field returns error with correct path", () => {
  const schema = v.object({
    name: v.string()
  });
  const result = schema.parse({});
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.errors[0].path, "name");
  }
});

test("Validation - 55. Nested object error path uses dot notation", () => {
  const schema = v.object({
    user: v.object({
      email: v.string().email()
    })
  });
  const result = schema.parse({ user: { email: "invalid" } });
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.errors[0].path, "user.email");
  }
});

test("Validation - 56. v.string().email() rejects malformed email", () => {
  const schema = v.string().email();
  assert.strictEqual(schema.parse("not-an-email").success, false);
  assert.strictEqual(schema.parse("test@example.com").success, true);
});

test("Validation - 57. v.number().integer() rejects float", () => {
  const schema = v.number().integer();
  assert.strictEqual(schema.parse(1.5).success, false);
  assert.strictEqual(schema.parse(1).success, true);
});

test("Validation - 58. v.array().minItems() rejects short array", () => {
  const schema = v.array(v.string()).minItems(2);
  assert.strictEqual(schema.parse(["a"]).success, false);
  assert.strictEqual(schema.parse(["a", "b"]).success, true);
});

test("Validation - 59. v.enum() rejects value not in list", () => {
  const schema = v.enum(["admin", "user"]);
  assert.strictEqual(schema.parse("guest").success, false);
  assert.strictEqual(schema.parse("admin").success, true);
});

test("Validation - 60. .optional() allows field to be absent", () => {
  const schema = v.object({
    name: v.string().optional()
  });
  assert.strictEqual(schema.parse({}).success, true);
});

test("Validation - 61. Multiple validation errors returned in one result", () => {
  const schema = v.object({
    a: v.string(),
    b: v.string()
  });
  const result = schema.parse({});
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.errors.length, 2);
  }
});

test("Validation - 62. validate() middleware returns 422 with structured errors on failure", async () => {
  const app = new Velo();
  app.post("/test", validate({
    body: v.object({ name: v.string() })
  }), (ctx: Context) => ctx.res.send("ok"));
  
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.error, "Validation failed");
    assert.ok(Array.isArray(data.fields));
  } finally {
    await app.close();
  }
});

test("Validation - 63. validate() attaches parsed data to ctx.req.locals.validated", async () => {
  const app = new Velo();
  let validated: any = null;
  app.post("/test", validate({
    body: v.object({ name: v.string() })
  }), (ctx: Context) => {
    validated = (ctx.req.locals as any).validated;
    ctx.res.send("ok");
  });
  
  await app.listen(0);
  const port = app.port;
  try {
    await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob" })
    });
    assert.deepStrictEqual(validated.body, { name: "Bob" });
  } finally {
    await app.close();
  }
});

test("Validation - BodyAlreadyConsumedError if json() called after validate() with body schema", async () => {
  const app = new Velo();
  app.post("/test", validate({
    body: v.object({ name: v.string() })
  }), async (ctx: Context) => {
    try {
      await ctx.req.json();
      ctx.res.send("ok");
    } catch (e: any) {
      ctx.res.status(500).send(e.name);
    }
  });
  
  await app.listen(0);
  const port = app.port;
  try {
    const res = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob" })
    });
    const text = await res.text();
    assert.strictEqual(text, "BodyAlreadyConsumedError");
  } finally {
    await app.close();
  }
});
