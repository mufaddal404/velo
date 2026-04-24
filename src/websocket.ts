import { createHash } from "node:crypto";
import { type VeloRequest } from "./request.js";
import { type Context } from "./middleware.js";
import { Response } from "./response.js";

export interface VeloWebSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  ping(data?: string): void;
  readonly readyState: "open" | "closing" | "closed";
  readonly params: Record<string, string>;
  locals: Record<string, unknown>;
}

export interface WebSocketHandler {
  open(ws: VeloWebSocket, ctx: Context): void;
  message(ws: VeloWebSocket, data: string | Buffer): void;
  close(ws: VeloWebSocket, code: number, reason: string): void;
  error?(ws: VeloWebSocket, error: Error): void;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function handleUpgrade(req: VeloRequest, socket: any, head: Buffer, handler: WebSocketHandler) {
  const key = req.header("sec-websocket-key");
  const upgrade = req.header("upgrade");
  const connection = req.header("connection");

  if (!key || upgrade?.toLowerCase() !== "websocket" || !connection?.toLowerCase().includes("upgrade")) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(key + GUID).digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const ws = new VeloWebSocketImpl(socket, req.params);
  const ctx: Context = { req, res: new Response(null as any) }; // Minimal ctx

  handler.open(ws, ctx);

  socket.on("data", (data: Buffer) => {
    ws.handleData(data, handler);
  });

  socket.on("close", () => {
    ws.handleSocketClose(handler);
  });

  socket.on("error", (err: Error) => {
    if (handler.error) handler.error(ws, err);
    socket.destroy();
  });
}

class VeloWebSocketImpl implements VeloWebSocket {
  private _readyState: "open" | "closing" | "closed" = "open";
  public locals: Record<string, unknown> = {};
  private buffer = Buffer.alloc(0);

  constructor(private socket: any, public params: Record<string, string>) {}

  get readyState() { return this._readyState; }

  handleSocketClose(handler: WebSocketHandler) {
    if (this._readyState !== "closed") {
      this._readyState = "closed";
      handler.close(this, 1000, "");
    }
  }

  send(data: string | Buffer) {
    if (this._readyState !== "open") return;
    const payload = typeof data === "string" ? Buffer.from(data) : data;
    const opcode = typeof data === "string" ? 0x01 : 0x02;
    this.sendFrame(opcode, payload);
  }

  close(code = 1000, reason = "") {
    if (this._readyState !== "open") return;
    this._readyState = "closing";
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.sendFrame(0x08, payload);
    // RFC 6455: Wait for close frame response (echo) before closing the connection
  }

  ping(data = "") {
    this.sendFrame(0x09, Buffer.from(data));
  }

  private sendFrame(opcode: number, payload: Buffer) {
    const header = Buffer.alloc(2 + (payload.length > 125 ? (payload.length > 65535 ? 8 : 2) : 0));
    header[0] = 0x80 | opcode; // FIN + opcode

    if (payload.length <= 125) {
      header[1] = payload.length;
    } else if (payload.length <= 65535) {
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    this.socket.write(Buffer.concat([header, payload]));
  }

  handleData(data: Buffer, handler: WebSocketHandler) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) break;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) break;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskingKey: Buffer | null = null;
      if (masked) {
        if (this.buffer.length < offset + 4) break;
        maskingKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) break;

      let payload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      if (masked && maskingKey) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          unmasked[i] = payload[i] ^ maskingKey[i % 4];
        }
        payload = unmasked;
      }

      this.processFrame(opcode, payload, fin, handler);
    }
  }

  private fragmentedBuffer = Buffer.alloc(0);
  private fragmentedOpcode = 0;

  private processFrame(opcode: number, payload: Buffer, fin: boolean, handler: WebSocketHandler) {
    if (opcode === 0x00) { // Continuation frame
      this.fragmentedBuffer = Buffer.concat([this.fragmentedBuffer, payload]);
      if (fin) {
        this.deliverMessage(this.fragmentedOpcode, this.fragmentedBuffer, handler);
        this.fragmentedBuffer = Buffer.alloc(0);
      }
    } else if (opcode === 0x01 || opcode === 0x02) { // Text or Binary
      if (!fin) {
        this.fragmentedOpcode = opcode;
        this.fragmentedBuffer = Buffer.from(payload);
      } else {
        this.deliverMessage(opcode, payload, handler);
      }
    } else if (opcode === 0x08) { // Close
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
      const reason = payload.length > 2 ? payload.toString("utf8", 2) : "";

      if (this._readyState === "closing") {
        this._readyState = "closed";
        handler.close(this, code, reason);
        this.socket.destroy();
      } else {
        this._readyState = "closed";
        // Echo the close frame
        const echoPayload = Buffer.alloc(2);
        echoPayload.writeUInt16BE(code, 0);
        this.sendFrame(0x08, echoPayload);
        handler.close(this, code, reason);
        this.socket.destroy();
      }
    } else if (opcode === 0x09) { // Ping
      this.sendFrame(0x0a, payload); // Pong
    }
  }

  private deliverMessage(opcode: number, payload: Buffer, handler: WebSocketHandler) {
    if (opcode === 0x01) {
      handler.message(this, payload.toString("utf8"));
    } else {
      handler.message(this, payload);
    }
  }
}
