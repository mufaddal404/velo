import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { staticFiles } from "../src/static.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Socket } from "node:net";

test("Static - serves existing file with correct content-type", async () => {
  const root = "./temp_static";
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "hello.txt"), "hello world");
  
  const app = new Velo();
  app.register(staticFiles, { root });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const res = await fetch(`http://localhost:${address.port}/hello.txt`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "text/plain");
    assert.strictEqual(await res.text(), "hello world");
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Static - path traversal protection", async () => {
  const root = "./temp_static_traversal";
  mkdirSync(root, { recursive: true });
  
  const app = new Velo();
  app.register(staticFiles, { root });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const socket = new Socket();
    await new Promise<void>((resolve) => socket.connect(address.port, "localhost", resolve));
    
    await new Promise<void>((resolve, reject) => {
      socket.write("GET /../package.json HTTP/1.1\r\nHost: localhost\r\n\r\n");
      socket.on("data", (data) => {
        const response = data.toString();
        if (response.includes("HTTP/1.1 403")) {
          resolve();
        } else {
          reject(new Error("Expected 403 but got: " + response.split("\r\n")[0]));
        }
        socket.destroy();
      });
      socket.on("error", reject);
    });
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Static - dotfiles deny", async () => {
  const root = "./temp_static_dot";
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".secret"), "shhh");
  
  const app = new Velo();
  app.register(staticFiles, { root, dotFiles: "deny" });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const res = await fetch(`http://localhost:${address.port}/.secret`);
    assert.strictEqual(res.status, 403);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Static - Range request returns 206", async () => {
  const root = "./temp_static_range";
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "large.txt"), "0123456789");
  
  const app = new Velo();
  app.register(staticFiles, { root });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const res = await fetch(`http://localhost:${address.port}/large.txt`, {
      headers: { "Range": "bytes=2-5" }
    });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(await res.text(), "2345");
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
