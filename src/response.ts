import { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { ResponseAlreadySentError } from "./errors.js";
import { type VeloOptions } from "./server.js";

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
  domain?: string;
}

export interface VeloResponse {
  raw: ServerResponse;
  status(code: number): this;
  getStatus(): number;
  set(name: string, value: string): this;
  get(name: string): string | undefined;
  remove(name: string): this;
  type(contentType: string): this;
  send(body?: string | Buffer | object): void;
  json(data: unknown): void;
  html(body: string): void;
  redirect(url: string, code?: number): void;
  stream(readable: Readable): void;
  cookie(name: string, value: string, options?: CookieOptions): this;
  clearCookie(name: string): this;
  sent: boolean;
}

export class Response implements VeloResponse {
  public sent = false;

  constructor(public raw: ServerResponse, private options: VeloOptions = {}) {
    if (this.raw && this.options.clock) {
        this.set("Date", new Date(this.options.clock()).toUTCString());
    }
  }

  status(code: number): this {
    if (this.raw) this.raw.statusCode = code;
    return this;
  }

  getStatus(): number {
    return this.raw ? this.raw.statusCode : 0;
  }

  set(name: string, value: string): this {
    if (this.raw) this.raw.setHeader(name, value);
    return this;
  }

  get(name: string): string | undefined {
    if (!this.raw) return undefined;
    const val = this.raw.getHeader(name);
    return typeof val === "string" ? val : undefined;
  }

  remove(name: string): this {
    if (this.raw) this.raw.removeHeader(name);
    return this;
  }

  type(contentType: string): this {
    this.set("Content-Type", contentType);
    return this;
  }

  send(body?: string | Buffer | object): void {
    if (this.sent) throw new ResponseAlreadySentError();
    this.sent = true;

    if (!this.raw) return;

    if (body === undefined || body === null) {
      this.raw.end();
      return;
    }

    if (typeof body === "object" && !Buffer.isBuffer(body)) {
      const json = JSON.stringify(body);
      if (!this.get("Content-Type")) this.type("application/json");
      this.set("Content-Length", Buffer.byteLength(json).toString());
      this.raw.end(json);
      return;
    }

    if (typeof body === "string") {
      if (!this.get("Content-Type")) this.type("text/plain");
      this.raw.end(body);
      return;
    }

    if (Buffer.isBuffer(body)) {
      if (!this.get("Content-Type")) this.type("application/octet-stream");
      this.raw.end(body);
      return;
    }
  }

  json(data: unknown): void {
    if (!this.get("Content-Type")) this.type("application/json");
    this.send(data as string | Buffer | object);
  }

  html(body: string): void {
    this.type("text/html");
    this.send(body);
  }

  redirect(url: string, code = 302): void {
    this.status(code);
    this.set("Location", url);
    this.send();
  }

  stream(readable: Readable): void {
    if (this.sent) throw new ResponseAlreadySentError();
    this.sent = true;
    if (this.raw) {
      readable.on("error", (err) => {
        if (!this.raw.headersSent) {
          this.sent = false;
          this.status(500).send("Internal Server Error");
        } else {
          this.raw.destroy();
        }
      });
      readable.pipe(this.raw);
    }
  }

  cookie(name: string, value: string, options: CookieOptions = {}): this {
    let str = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    if (options.maxAge !== undefined) {
        str += `; Max-Age=${options.maxAge}`;
        if (!options.expires && this.options.clock) {
            const expires = new Date(this.options.clock() + options.maxAge * 1000);
            str += `; Expires=${expires.toUTCString()}`;
        }
    }
    if (options.expires) str += `; Expires=${options.expires.toUTCString()}`;
    if (options.httpOnly) str += "; HttpOnly";
    if (options.secure) str += "; Secure";
    if (options.sameSite) str += `; SameSite=${options.sameSite}`;
    if (options.path) str += `; Path=${options.path}`;
    if (options.domain) str += `; Domain=${options.domain}`;

    if (!this.raw) return this;

    const existing = this.raw.getHeader("Set-Cookie");
    if (!existing) {
      this.raw.setHeader("Set-Cookie", str);
    } else if (Array.isArray(existing)) {
      this.raw.setHeader("Set-Cookie", [...existing, str]);
    } else {
      this.raw.setHeader("Set-Cookie", [existing as string, str]);
    }

    return this;
  }

  clearCookie(name: string): this {
    return this.cookie(name, "", { maxAge: 0 });
  }
}
