import { IncomingMessage } from "node:http";
import { parse as parseQuery } from "node:querystring";
import { BadRequestError, PayloadTooLargeError, BodyAlreadyConsumedError } from "./errors.js";

export interface VeloRequest {
  raw: IncomingMessage;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[]>;
  header(name: string): string | undefined;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  buffer(): Promise<Buffer>;
  ip: string;
  hostname: string;
  protocol: "http" | "https";
  secure: boolean;
  xhr: boolean;
  cookies: Record<string, string>;
  locals: Record<string, unknown>;
}

export class Request implements VeloRequest {
  public params: Record<string, string> = {};
  public locals: Record<string, unknown> = {};
  private _body: Buffer | null = null;
  private _bodyConsumed = false;

  constructor(
    public raw: IncomingMessage,
    private options: { trustProxy?: boolean; bodyLimit?: number } = {}
  ) {}

  get method() {
    return this.raw.method || "GET";
  }

  get path() {
    const url = this.raw.url || "/";
    return url.split("?")[0];
  }

  get query() {
    const url = this.raw.url || "/";
    const queryString = url.split("?")[1] || "";
    return parseQuery(queryString) as Record<string, string | string[]>;
  }

  get headers() {
    return this.raw.headers as Record<string, string | string[]>;
  }

  header(name: string): string | undefined {
    const val = this.raw.headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0];
    return val;
  }

  async buffer(): Promise<Buffer> {
    if (this._bodyConsumed) throw new BodyAlreadyConsumedError();
    this._bodyConsumed = true;

    const limit = this.options.bodyLimit || 1024 * 1024; // 1MB default
    let received = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of this.raw) {
      received += chunk.length;
      if (received > limit) throw new PayloadTooLargeError();
      chunks.push(chunk);
    }

    this._body = Buffer.concat(chunks);
    return this._body;
  }

  async text(): Promise<string> {
    const buf = await this.buffer();
    return buf.toString("utf8");
  }

  async json<T = unknown>(): Promise<T> {
    const contentType = this.header("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new BadRequestError("Content-Type must be application/json");
    }
    const text = await this.text();
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new BadRequestError("Invalid JSON");
    }
  }

  get ip() {
    if (this.options.trustProxy) {
      const forwarded = this.header("x-forwarded-for");
      if (forwarded) return forwarded.split(",")[0].trim();
    }
    return this.raw.socket.remoteAddress || "";
  }

  get hostname() {
    const host = this.header("host") || "";
    return host.split(":")[0];
  }

  get protocol(): "http" | "https" {
    if (this.options.trustProxy) {
      const proto = this.header("x-forwarded-proto");
      if (proto) return proto.split(",")[0].trim() as "http" | "https";
    }
    return (this.raw.socket as any).encrypted ? "https" : "http";
  }

  get secure() {
    return this.protocol === "https";
  }

  get xhr() {
    return this.header("x-requested-with") === "XMLHttpRequest";
  }

  get cookies() {
    const cookieHeader = this.header("cookie") || "";
    const cookies: Record<string, string> = {};
    cookieHeader.split(";").forEach((pair) => {
      const [key, value] = pair.split("=").map((s) => s.trim());
      if (key && value) cookies[key] = value;
    });
    return cookies;
  }
}
