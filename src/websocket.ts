import { createHash } from "node:crypto";
import { type VeloRequest } from "./request.js";
import { type Context } from "./middleware.js";
import { Response } from "./response.js";
import { type Socket } from "node:net";

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

export function handleUpgrade(req: VeloRequest, socket: Socket, head: Buffer, handler: WebSocketHandler, options: { bodyLimit?: number } = {}) {
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

  const ws = new VeloWebSocketImpl(socket, req.params, options.bodyLimit);
  // Create a minimal response that doesn't cause crashes but throws if used improperly
  const vRes = new Response(null as unknown as any, options);
  const ctx: Context = { req, res: vRes };

  handler.open(ws, ctx);

  socket.on("data", (data: Buffer) => {
    try {
        ws.handleData(data, handler);
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (handler.error) handler.error(ws, error);
        socket.destroy();
    }
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
  private fragmentedBuffer = Buffer.alloc(0);
  private fragmentedOpcode = 0;
  private maxBufferSize: number;

  constructor(private socket: Socket, public params: Record<string, string>, maxBufferSize?: number) {
    this.maxBufferSize = maxBufferSize || 1024 * 1024; // Default 1MB
  }

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
    if (this.buffer.length + data.length > this.maxBufferSize) {
        throw new Error("WebSocket buffer overflow");
    }
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      
      const fin = (firstByte & 0x80) !== 0;
      const rsv = firstByte & 0x70;
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength: number | bigint = secondByte & 0x7f;
      
      // RFC 6455: RSV bits must be 0
      if (rsv !== 0) {
        throw new Error("RSV bits must be zero");
      }

      // RFC 6455: Clients MUST mask frames
      if (!masked) {
        throw new Error("Client frames must be masked");
      }

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) break;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) break;
        payloadLength = this.buffer.readBigUInt64BE(2);
        offset = 10;
      }

      const length = Number(payloadLength);
      if (length > this.maxBufferSize) {
          throw new Error("WebSocket payload too large");
      }

      if (this.buffer.length < offset + 4) break;
      const maskingKey = this.buffer.slice(offset, offset + 4);
      offset += 4;

      if (this.buffer.length < offset + length) break;

      let payload = this.buffer.slice(offset, offset + length);
      this.buffer = this.buffer.slice(offset + length);

      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ maskingKey[i % 4];
      }
      payload = unmasked;

      this.processFrame(opcode, payload, fin, handler);
    }
  }

  private processFrame(opcode: number, payload: Buffer, fin: boolean, handler: WebSocketHandler) {
    // Control frames (opcode >= 0x08)
    if (opcode >= 0x08) {
      if (!fin) throw new Error("Control frames must not be fragmented");
      if (payload.length > 125) throw new Error("Control frames must have payload length <= 125");

      if (opcode === 0x08) { // Close
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.toString("utf8", 2) : "";

        if (this._readyState === "closing") {
          this._readyState = "closed";
          handler.close(this, code, reason);
          this.socket.destroy();
        } else {
          this._readyState = "closed";
          const echoPayload = Buffer.alloc(2);
          echoPayload.writeUInt16BE(code, 0);
          this.sendFrame(0x08, echoPayload);
          handler.close(this, code, reason);
          this.socket.destroy();
        }
      } else if (opcode === 0x09) { // Ping
        this.sendFrame(0x0a, payload); // Pong
      } else if (opcode === 0x0a) { // Pong
        // Ignore unsolicited pongs
      }
      return;
    }

    // Data frames (opcode < 0x08)
    if (opcode === 0x00) { // Continuation frame
      if (this.fragmentedOpcode === 0) throw new Error("Unexpected continuation frame");
      if (this.fragmentedBuffer.length + payload.length > this.maxBufferSize) {
          throw new Error("WebSocket fragmented buffer overflow");
      }
      this.fragmentedBuffer = Buffer.concat([this.fragmentedBuffer, payload]);
      if (fin) {
        this.deliverMessage(this.fragmentedOpcode, this.fragmentedBuffer, handler);
        this.fragmentedBuffer = Buffer.alloc(0);
        this.fragmentedOpcode = 0;
      }
    } else { // Text (0x01) or Binary (0x02)
      if (this.fragmentedOpcode !== 0) throw new Error("Expected continuation frame");
      if (!fin) {
        this.fragmentedOpcode = opcode;
        this.fragmentedBuffer = Buffer.from(payload);
      } else {
        this.deliverMessage(opcode, payload, handler);
      }
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
