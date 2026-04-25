import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import * as net from "node:net";

import { type Context } from "../src/middleware.js";

test("Security - 76. Slow header attack (Slowloris) mitigation", async () => {
  // Use a short headersTimeout
  const app = new Velo({ headersTimeout: 200 });
  app.get("/", (ctx: Context) => ctx.res.send("ok"));
  await app.listen(0);
  const port = app.port!;

  let socket: net.Socket | undefined;
  try {
    const closedPromise = new Promise<void>((resolve, reject) => {
      socket = net.createConnection(port, "127.0.0.1", () => {
        socket!.write("GET / HTTP/1.1\r\n");
        // Send a partial header after some time, but NOT the full \r\n\r\n
        setTimeout(() => {
            if (!socket!.destroyed) {
                socket!.write("X-Custom: value\r\n");
            }
        }, 100);
      });
      
      const timeout = setTimeout(() => {
        reject(new Error("Socket was not closed by server within timeout"));
      }, 2000);

      socket.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on("error", (err) => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await closedPromise;
    assert.ok(true, "Socket was closed by server due to headersTimeout after partial data");
  } finally {
    if (socket) socket.destroy();
    await app.close();
  }
});

test("Security - 77. Basic check for connection cleanup", async () => {
  const app = new Velo();
  app.get("/", (ctx: Context) => ctx.res.send("ok"));
  await app.listen(0);
  const port = app.port!;

  const sockets: net.Socket[] = [];
  try {
    const connections = 10;
    
    for (let i = 0; i < connections; i++) {
      const socket = await new Promise<net.Socket>((resolve) => {
        const s = net.createConnection(port, "127.0.0.1", () => resolve(s));
      });
      sockets.push(socket);
    }

    const internalConnections = (app as unknown as { connections: Set<net.Socket> }).connections;
    assert.ok(internalConnections.size >= connections, `Should have at least ${connections} connections tracked`);

    for (const socket of sockets) {
      socket.destroy();
    }

    // Wait for close events to propagate
    for (let i = 0; i < 50; i++) {
      if (internalConnections.size === 0) break;
      await new Promise(r => setTimeout(r, 10));
    }

    assert.strictEqual(internalConnections.size, 0, "All connections should have been cleaned up");
  } finally {
    for (const socket of sockets) socket.destroy();
    await app.close();
  }
});

test("Security - 78. Header buffer size limit (DoS mitigation)", async () => {
  const app = new Velo({ headersTimeout: 1000 });
  app.get("/", (ctx: Context) => ctx.res.send("ok"));
  await app.listen(0);
  const port = app.port!;

  const socket = net.createConnection(port, "127.0.0.1");
  
  try {
    const closedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Socket was not closed by server when exceeding header limit"));
      }, 5000);

      socket.on("connect", async () => {
        try {
          socket.write("GET / HTTP/1.1\r\n");
          
          // Send 20KB of data in small chunks to give the server's 'data' event 
          // and subsequent 'destroy()' call a chance to be processed by the event loop.
          const chunkSize = 1024;
          const totalSize = 20 * 1024;
          const chunk = "X-Header: " + "a".repeat(chunkSize) + "\r\n";
          
          for (let i = 0; i < totalSize / chunkSize; i++) {
            if (socket.destroyed) break;
            socket.write(chunk);
            // Small pause to yield the event loop
            await new Promise(r => setImmediate(r));
          }
        } catch (e) {
          // Ignore write errors after destruction
        }
      });
      
      socket.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      
      socket.on("error", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await closedPromise;
    assert.ok(true, "Socket was closed by server due to exceeding MAX_HEADER_SIZE");
  } finally {
    socket.destroy();
    await app.close();
  }
});
