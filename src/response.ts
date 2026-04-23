import { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { ResponseAlreadySentError } from "./errors.js";

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

  constructor(public raw: ServerResponse) {}

  status(code: number): this {
    this.raw.statusCode = code;
    return this;
  }

  getStatus(): number {
    return this.raw.statusCode;
  }

  set(name: string, value: string): this {
    this.raw.setHeader(name, value);
    return this;
  }

  get(name: string): string | undefined {
    const val = this.raw.getHeader(name);
    return typeof val === "string" ? val : undefined;
  }

  remove(name: string): this {
    this.raw.removeHeader(name);
    return this;
  }

  type(contentType: string): this {
    this.set("Content-Type", contentType);
    return this;
  }

  send(body?: string | Buffer | object): void {
    if (this.sent) throw new ResponseAlreadySentError();
    this.sent = true;

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
    this.type("application/json");
    this.send(data as any);
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
    readable.pipe(this.raw);
  }

  cookie(name: string, value: string, options: CookieOptions = {}): this {
    let str = `${name}=${value}`;

    if (options.maxAge !== undefined) str += `; Max-Age=${options.maxAge}`;
    if (options.expires) str += `; Expires=${options.expires.toUTCString()}`;
    if (options.httpOnly) str += "; HttpOnly";
    if (options.secure) str += "; Secure";
    if (options.sameSite) str += `; SameSite=${options.sameSite}`;
    if (options.path) str += `; Path=${options.path}`;
    if (options.domain) str += `; Domain=${options.domain}`;

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
