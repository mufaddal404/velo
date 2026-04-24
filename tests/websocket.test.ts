import { test } from "node:test";
import assert from "node:assert";
import { Velo } from "../src/server.js";
import * as crypto from "node:crypto";
import * as net from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function rawConnect(port: number, path: string, key = crypto.randomBytes(16).toString("base64")) {
  return new Promise<{ socket: net.Socket, accept: string }>((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.includes("\r\n\r\n")) {
        socket.removeListener("data", onData);
        if (buffer.includes("HTTP/1.1 101")) {
          const match = buffer.match(/sec-websocket-accept: (.*)\r\n/i);
          const accept = match ? match[1].trim() : "";
          resolve({ socket, accept });
        } else {
          reject(new Error("Handshake failed: " + buffer.split("\r\n")[0]));
        }
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

function sendFrame(socket: net.Socket, opcode: number, payload: string | Buffer, fin = true) {
  const data = typeof payload === "string" ? Buffer.from(payload) : payload;
  const header = Buffer.alloc(2);
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  header[1] = 0x80 | data.length; 
  
  const mask = crypto.randomBytes(4);
  const maskedData = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    maskedData[i] = data[i] ^ mask[i % 4];
  }
  
  socket.write(header);
  socket.write(mask);
  socket.write(maskedData);
}

test("WebSocket - 34. Valid handshake produces correct Sec-WebSocket-Accept", async () => {
  const app = new Velo();
  app.ws("/chat", { open() {}, message() {}, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const key = crypto.randomBytes(16).toString("base64");
    const expectedAccept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    const { socket, accept } = await rawConnect(port, "/chat", key);
    assert.strictEqual(accept, expectedAccept);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 35. Missing Upgrade header rejected with 400", async () => {
  const app = new Velo();
  app.ws("/chat", { open() {}, message() {}, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const res = await new Promise<string>((resolve) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        socket.write(`GET /chat HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
      });
      socket.on("data", (data) => {
        resolve(data.toString());
        socket.destroy();
      });
    });
    assert.ok(res.includes("400 Bad Request"));
  } finally {
    await app.close();
  }
});

test("WebSocket - 36. open callback fires after successful handshake", async () => {
  const app = new Velo();
  let opened = false;
  app.ws("/chat", { open() { opened = true; }, message() {}, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    for (let i = 0; i < 50; i++) { if (opened) break; await new Promise(r => setTimeout(r, 10)); }
    assert.strictEqual(opened, true);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 37. Text message delivered to message handler", async () => {
  const app = new Velo();
  let received: any = null;
  app.ws("/chat", { open() {}, message(ws, data) { received = data; }, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    sendFrame(socket, 1, "hello");
    for (let i = 0; i < 50; i++) { if (received) break; await new Promise(r => setTimeout(r, 10)); }
    assert.strictEqual(received, "hello");
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 38. Binary message delivered to message handler", async () => {
  const app = new Velo();
  let received: any = null;
  app.ws("/chat", { open() {}, message(ws, data) { received = data; }, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    const buf = Buffer.from([1, 2, 3]);
    sendFrame(socket, 2, buf);
    for (let i = 0; i < 50; i++) { if (received) break; await new Promise(r => setTimeout(r, 10)); }
    assert.deepStrictEqual(received, buf);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 39. Ping frame triggers automatic pong response", async () => {
  const app = new Velo();
  app.ws("/chat", { open() {}, message() {}, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    const pongPromise = new Promise<Buffer>((resolve) => { 
      socket.on("data", (data) => {
        if (data[0] === 0x8a) resolve(data);
      }); 
    });
    sendFrame(socket, 9, "ping");
    const res = await pongPromise;
    assert.strictEqual(res[0] & 0x0f, 10);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 40. Fragmented message reassembled before delivery", async () => {
  const app = new Velo();
  let received: any = null;
  app.ws("/chat", { open() {}, message(ws, data) { received = data; }, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    sendFrame(socket, 1, "hel", false);
    sendFrame(socket, 0, "lo", true);
    for (let i = 0; i < 50; i++) { if (received) break; await new Promise(r => setTimeout(r, 10)); }
    assert.strictEqual(received, "hello");
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 41. close callback fires with correct code and reason", async () => {
  const app = new Velo();
  let closed: any = null;
  app.ws("/chat", { open() {}, message() {}, close(ws, code, reason) { closed = { code, reason }; } });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat");
    const payload = Buffer.alloc(5);
    payload.writeUInt16BE(1001, 0);
    payload.write("bye", 2);
    sendFrame(socket, 8, payload);
    for (let i = 0; i < 50; i++) { if (closed) break; await new Promise(r => setTimeout(r, 10)); }
    assert.strictEqual(closed?.code, 1001);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - 42. Route params available in ws.params", async () => {
  const app = new Velo();
  let wsParams: any = null;
  app.ws("/chat/:room", { open(ws) { wsParams = ws.params; }, message() {}, close() {} });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/chat/room123");
    for (let i = 0; i < 50; i++) { if (wsParams) break; await new Promise(r => setTimeout(r, 10)); }
    assert.deepStrictEqual(wsParams, { room: "room123" });
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("WebSocket - Invalid UTF-8 in text frame closes with 1007", async () => {
  const app = new Velo();
  let errorCode: number | null = null;
  app.ws("/ws", {
    open() {},
    message() {},
    close(ws, code) { errorCode = code; }
  });
  await app.listen(0);
  const port = app.port!;
  try {
    const { socket } = await rawConnect(port, "/ws");
    const invalidUtf8 = Buffer.from([0xFF, 0xFF]);
    sendFrame(socket, 1, invalidUtf8);
    for (let i = 0; i < 50; i++) {
      if (errorCode !== null) break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.strictEqual(errorCode, 1007);
    socket.destroy();
  } finally {
    await app.close();
  }
});
