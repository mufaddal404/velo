import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";

test("Plugin - receives app instance and options", async () => {
  const app = new Velo();
  let pluginApp: any;
  let pluginOptions: any;
  
  const plugin = async (instance: Velo, opts: any) => {
    pluginApp = instance;
    pluginOptions = opts;
  };
  
  await app.register(plugin, { foo: "bar" });
  assert.strictEqual(pluginApp, app);
  assert.deepStrictEqual(pluginOptions, { foo: "bar" });
});

test("Plugin - app.decorate() attaches value to app instance", async () => {
  const app = new Velo();
  app.decorate("db", { connected: true });
  assert.strictEqual((app as any).db.connected, true);
});

test("Plugin - can register routes", async () => {
  const app = new Velo();
  const plugin = (instance: Velo) => {
    instance.get("/plugin-route", (ctx: Context) => ctx.res.send("from plugin"));
  };
  
  await app.register(plugin);
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const res = await fetch(`http://localhost:${address.port}/plugin-route`);
    assert.strictEqual(await res.text(), "from plugin");
  } finally {
    await app.close();
  }
});
