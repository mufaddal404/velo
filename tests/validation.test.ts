import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { v, validate } from "../src/validation.js";
import { Velo } from "../src/server.js";

test("Validation - Valid object passes", () => {
  const schema = v.object({
    name: v.string().minLength(3),
    age: v.number().min(18)
  });
  
  const result = schema.parse({ name: "John", age: 25 });
  assert.strictEqual(result.success, true);
  if (result.success) {
    assert.deepStrictEqual(result.data, { name: "John", age: 25 });
  }
});

test("Validation - Missing required field returns error", () => {
  const schema = v.object({
    name: v.string()
  });
  
  const result = schema.parse({});
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.errors[0].path, "name");
    assert.strictEqual(result.errors[0].message, "required");
  }
});

test("Validation - string constraints", () => {
  const schema = v.string().minLength(5).maxLength(10).pattern(/^[a-z]+$/);
  assert.ok(schema.parse("hello").success);
  assert.ok(!schema.parse("hi").success);
  assert.ok(!schema.parse("toolongstring").success);
  assert.ok(!schema.parse("HELLO").success);
});

test("Validation - number constraints", () => {
  const schema = v.number().integer().positive().min(10).max(20);
  assert.ok(schema.parse(15).success);
  assert.ok(!schema.parse(15.5).success);
  assert.ok(!schema.parse(-5).success);
  assert.ok(!schema.parse(5).success);
  assert.ok(!schema.parse(25).success);
});

test("Validation - enum and optional", () => {
  const schema = v.enum(["admin", "user"]).optional();
  assert.ok(schema.parse("admin").success);
  assert.ok(schema.parse(undefined).success);
  assert.ok(!schema.parse("guest").success);
});

test("Validation - multiple errors returned", () => {
  const schema = v.object({
    a: v.string(),
    b: v.number()
  });
  const result = schema.parse({ a: 1, b: "2" });
  assert.strictEqual(result.success, false);
  if (!result.success) {
    assert.strictEqual(result.errors.length, 2);
  }
});

test("Validation - validate() middleware returns 422 on failure", async () => {
  const app = new Velo();
  const schema = v.object({
    id: v.number().integer()
  });
  
  app.post("/test", validate({ body: schema }), (ctx: Context) => {
    ctx.res.send("ok");
  });
  
  await app.listen(0);
  const address = (app as any).server.address();
  try {
    const res = await fetch(`http://localhost:${address.port}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "not-a-number" })
    });
    
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.error, "Validation failed");
    assert.ok(Array.isArray(data.fields));
  } finally {
    await app.close();
  }
});
