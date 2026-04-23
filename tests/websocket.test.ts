import { type Context } from "../src/middleware.js";
import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import { WebSocket } from "ws";

test("WebSocket - Valid handshake and text message", async () => {
  const app = new Velo();
  let receivedData = "";
  
  app.ws("/chat/:room", {
    open(ws) {
      assert.strictEqual(ws.params.room, "lobby");
    },
    message(ws, data) {
      receivedData = data.toString();
      ws.send("pong");
    },
    close() {}
  });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const ws = new WebSocket(`ws://localhost:${address.port}/chat/lobby`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.send("ping");
      });
      ws.on("message", (data) => {
        if (data.toString() === "pong") {
          assert.strictEqual(receivedData, "ping");
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timeout")), 2000);
    });
  } finally {
    await app.close();
  }
});

test("WebSocket - Ping/Pong response", async () => {
  const app = new Velo();
  app.ws("/ping", {
    open() {},
    message() {},
    close() {}
  });
  
  await app.listen(0);
  const address = (app as any).server.address();
  
  try {
    const ws = new WebSocket(`ws://localhost:${address.port}/ping`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.ping("hello");
      });
      ws.on("pong", (data) => {
        assert.strictEqual(data.toString(), "hello");
        ws.close();
        resolve();
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timeout")), 2000);
    });
  } finally {
    await app.close();
  }
});
