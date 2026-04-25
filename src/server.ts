import { createServer as createHttpServer, Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Request } from "./request.js";
import { Response } from "./response.js";
import { Router } from "./router.js";
import { type Middleware, type Handler, type ErrorHandler, compose, type Context, type VeloHandler } from "./middleware.js";
import { InternalServerError, NotFoundError, VeloError, MethodNotAllowedError, UnprocessableEntityError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { type WebSocketHandler, handleUpgrade as performWebSocketUpgrade } from "./websocket.js";

export interface VeloOptions {
  trustProxy?: boolean | number;
  bodyLimit?: number;
  clock?: () => number;
  headersTimeout?: number;
  keepAliveTimeout?: number;
  requestTimeout?: number;
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    [key: string]: unknown;
  };
}

interface RouteEntry<L extends Record<string, unknown>> {
  handlers: Middleware<L>[];
  scope: Velo<L>;
}

const wsHandlers = new WeakMap<Context<any>, WebSocketHandler>();

export class Velo<L extends Record<string, unknown> = Record<string, unknown>> {
  public server?: HttpServer | HttpsServer;
  public router: Router<RouteEntry<L>>;
  public wsRouter: Router<RouteEntry<L>>;
  protected middlewares: { prefix: string; fn: Middleware<L> }[] = [];
  protected _errorHandler?: ErrorHandler<L>;
  protected _notFoundHandler?: Handler<L>;
  
  protected parent: Velo<L> | null = null;
  protected basePath: string = "";
  protected connections = new Set<Socket | TLSSocket>();
  protected wsSockets = new WeakSet<Socket | TLSSocket>();

  get address() {
    return this.server?.address();
  }

  get port() {
    const addr = this.address;
    return addr && typeof addr === "object" ? addr.port : undefined;
  }

  constructor(protected _options: VeloOptions = {}, parent: Velo<L> | null = null, basePath: string = "") {
    this.parent = parent;
    this.basePath = basePath;
    
    // Set defaults for options
    this._options.trustProxy = _options.trustProxy ?? false;
    this._options.bodyLimit = _options.bodyLimit ?? 1024 * 1024;
    this._options.clock = _options.clock ?? Date.now;

    if (parent) {
      this.router = parent.router;
      this.wsRouter = parent.wsRouter;
      this.connections = parent.connections;
      this.wsSockets = parent.wsSockets;
    } else {
      this.router = new Router<RouteEntry<L>>();
      this.wsRouter = new Router<RouteEntry<L>>();
    }
  }

  private *walkLineage(): Generator<Velo<L>> {
    let curr: Velo<L> | null = this;
    while (curr) {
      yield curr;
      curr = curr.parent;
    }
  }

  // Helper to get effective handlers, traversing lineage if necessary
  protected get errorHandler(): ErrorHandler<L> {
    for (const scope of this.walkLineage()) {
      if (scope._errorHandler) return scope._errorHandler;
    }
    return this.defaultErrorHandler.bind(this);
  }

  protected get notFoundHandler(): Handler<L> {
    for (const scope of this.walkLineage()) {
      if (scope._notFoundHandler) return scope._notFoundHandler;
    }
    return () => { throw new NotFoundError(); };
  }

  use(middleware: Middleware<L>): this;
  use(prefix: string, middleware: Middleware<L>): this;
  use(arg1: string | Middleware<L>, arg2?: Middleware<L>): this {
    if (typeof arg1 === "string") {
      this.middlewares.push({ prefix: this.basePath + arg1, fn: arg2! });
    } else {
      this.middlewares.push({ prefix: this.basePath, fn: arg1 });
    }
    return this;
  }

  get(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("GET", path, handlers); return this; }
  post(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("POST", path, handlers); return this; }
  put(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("PUT", path, handlers); return this; }
  patch(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("PATCH", path, handlers); return this; }
  delete(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("DELETE", path, handlers); return this; }
  options(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("OPTIONS", path, handlers); return this; }
  head(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("HEAD", path, handlers); return this; }
  all(path: string, ...handlers: (Handler<L> | Middleware<L>)[]) { this.addRoute("ALL", path, handlers); return this; }

  ws(path: string, handler: WebSocketHandler) {
    const fullPath = this.basePath + path;
    const entry: RouteEntry<L> = {
      handlers: [this.wrapWebSocketHandler(handler)],
      scope: this
    };
    this.wsRouter.add("GET", fullPath, entry);
    return this;
  }

  private wrapWebSocketHandler(handler: WebSocketHandler): Middleware<L> {
    return async (ctx, next) => {
      wsHandlers.set(ctx, handler);
      await next();
    };
  }

  private addRoute(method: string, path: string, handlers: VeloHandler<L>[]) {
    const fullPath = this.basePath + path;
    const normalizedHandlers = handlers.map(h => {
      if (h.length > 1) return h as Middleware<L>;
      return (async (ctx, next) => {
        await (h as Handler<L>)(ctx);
        await next();
      }) as Middleware<L>;
    });
    const entry: RouteEntry<L> = {
      handlers: normalizedHandlers,
      scope: this
    };
    this.router.add(method, fullPath, entry);
  }

  group(prefix: string): Velo<L> {
    return new Velo<L>(this._options, this, this.basePath + prefix);
  }

  onError(handler: ErrorHandler<L>) {
    this._errorHandler = handler;
  }

  notFound(handler: Handler<L>) {
    this._notFoundHandler = handler;
  }

  async listen(port: number, hostname: string = "127.0.0.1"): Promise<void> {
    const root = this.getRoot();
    if (!root.server) {
      if (root._options.https) {
        root.server = createHttpsServer(root._options.https, (req, res) => root.handleRequest(req, res));
      } else {
        root.server = createHttpServer((req, res) => root.handleRequest(req, res));
      }

      if (root._options.headersTimeout) root.server.headersTimeout = root._options.headersTimeout;
      if (root._options.keepAliveTimeout) root.server.keepAliveTimeout = root._options.keepAliveTimeout;
      
      // requestTimeout is available from Node 14.11.0
      if (root._options.requestTimeout) {
        const server = root.server as HttpServer & { requestTimeout?: number };
        if (server.requestTimeout !== undefined) {
          server.requestTimeout = root._options.requestTimeout;
        }
      }
      
      root.server.on("connection", (socket: Socket) => root.setupSocketTimeout(socket));
      root.server.on("secureConnection", (socket: TLSSocket) => root.setupSocketTimeout(socket));
      root.server.on("upgrade", (req, socket, head) => {
        root.wsSockets.add(socket as Socket);
        root.connections.add(socket as Socket);
        socket.on("close", () => {
          root.connections.delete(socket as Socket);
        });
        root.handleUpgrade(req, socket as Socket, head);
      });
    }
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        reject(err);
      };
      root.server!.once("error", onError);
      root.server!.listen(port, hostname, () => {
        root.server!.removeListener("error", onError);
        resolve();
      });
    });
  }

  protected setupSocketTimeout(socket: Socket | TLSSocket) {
    const root = this.getRoot();
    root.connections.add(socket);

    if (root._options.headersTimeout) {
      let buffer = "";
      const timeout = setTimeout(() => {
        if (root.connections.has(socket) && !root.wsSockets.has(socket)) {
          socket.destroy();
        }
      }, root._options.headersTimeout);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("latin1");
        if (buffer.includes("\r\n\r\n")) {
          clearTimeout(timeout);
          socket.removeListener("data", onData);
        }
      };

      socket.on("data", onData);
      socket.on("close", () => clearTimeout(timeout));
    }

    socket.on("close", () => root.connections.delete(socket));
  }

  async close(): Promise<void> {
    const root = this.getRoot();
    if (!root.server) return;
    
    // Force close WebSockets as they don't naturally "end" like HTTP requests
    for (const socket of root.connections) {
      if (root.wsSockets.has(socket)) {
        socket.destroy();
      }
    }

    // Node.js 18.2.0+ supports closeIdleConnections()
    if (root.server && "closeIdleConnections" in root.server && typeof root.server.closeIdleConnections === "function") {
      (root.server as HttpServer & { closeIdleConnections: () => void }).closeIdleConnections();
    }
    
    return new Promise((resolve, reject) => {
      // server.close() stops accepting new connections but waits for existing ones to close naturally.
      root.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          root.server = undefined;
          resolve();
        }
      });
    });
  }

  protected getRoot(): Velo<L> {
    let root: Velo<L> = this;
    for (const scope of this.walkLineage()) {
      root = scope;
    }
    return root;
  }

  protected getMiddlewarePipeline(path: string, scope: Velo<L>): Middleware<L>[] {
    const pipeline: Middleware<L>[] = [];
    const lineage = Array.from(scope.walkLineage()).reverse();

    for (const s of lineage) {
      for (const mw of s.middlewares) {
        if (mw.prefix === "/" || mw.prefix === "") {
          pipeline.push(mw.fn);
          continue;
        }

        if (path === mw.prefix || path.startsWith(mw.prefix + "/")) {
          pipeline.push(mw.fn);
        }
      }
    }
    return pipeline;
  }

  protected async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const vReq = new Request<L>(req, this._options);
    const vRes = new Response(res, this._options);
    const ctx: Context<L> = { req: vReq, res: vRes };

    try {
      await this._dispatch(ctx);

      if (!vRes.sent) {
        throw new InternalServerError("Response not sent by handlers");
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.errorHandler(error, ctx);
    }
  }

  protected async _dispatch(ctx: Context<L>) {
    const matchInfo = this.router.match(ctx.req.method, ctx.req.path);
    const pipeline: Middleware<L>[] = [];

    if (matchInfo.result) {
      const { handlers, scope } = matchInfo.result.handlers;
      
      pipeline.push(...this.getMiddlewarePipeline(ctx.req.path, scope));

      ctx.req.params = { ...ctx.req.params, ...matchInfo.result.params };
      pipeline.push(...handlers);
    } else if (matchInfo.methodNotAllowed) {
      pipeline.push(async () => { throw new MethodNotAllowedError(); });
    } else {
      pipeline.push(async (c) => await this.notFoundHandler(c));
    }

    await compose(pipeline, ctx);
  }

  protected async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    const vReq = new Request<L>(req, this._options);
    const matchInfo = this.wsRouter.match("GET", vReq.path);

    if (!matchInfo.result) {
      socket.destroy();
      return;
    }

    const { handlers, scope } = matchInfo.result.handlers;
    
    vReq.params = { ...vReq.params, ...matchInfo.result.params };

    // Create a mock ServerResponse that writes to the socket
    // This allows middleware and error handlers to use ctx.res
    const res = new ServerResponse(req);
    res.assignSocket(socket);

    const vRes = new Response(res, this._options);
    const ctx: Context<L> = { req: vReq, res: vRes };

    const pipeline: Middleware<L>[] = this.getMiddlewarePipeline(vReq.path, scope);

    let wsHandler: WebSocketHandler | undefined;

    pipeline.push(...handlers);
    pipeline.push(async (c) => {
        wsHandler = wsHandlers.get(c);
        if (wsHandler) {
            // If it's a websocket upgrade, we should NOT have sent a response yet
            if (!vRes.sent) {
                performWebSocketUpgrade(c, socket, head, wsHandler, this._options);
                vRes.sent = true; // Mark as sent so we don't try to send more
            }
        }
    });

    try {
        await compose(pipeline, ctx);
        if (!vRes.sent) {
            throw new InternalServerError("Response not sent by handlers");
        }
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await this.errorHandler(error, ctx);
        if (!vRes.sent) {
            socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            socket.destroy();
        } else {
            // Even if sent, for upgrade requests that failed we should probably ensure socket is closed
            // if it wasn't a 101 Switching Protocols.
            if (res.statusCode !== 101) {
                process.nextTick(() => socket.destroy());
            }
        }
    }
  }

  protected async defaultErrorHandler(error: Error, ctx: Context<L>) {
    if (ctx.res.sent) return;

    let status = error instanceof VeloError ? error.status : 500;
    // If the response status was already set to something other than 200, respect it
    if (ctx.res.getStatus() !== 200 && !(error instanceof VeloError)) {
        status = ctx.res.getStatus();
    }
    
    const message = error instanceof VeloError ? error.message : error.message || "Internal Server Error";

    const body: Record<string, unknown> = {
      error: message,
      status: status
    };

    if (error instanceof UnprocessableEntityError && error.fields) {
      body.fields = error.fields;
    }

    if (ctx.res.raw) {
        ctx.res.status(status).json(body);
    }
  }

  async register<T>(plugin: Plugin<T, L>, options?: T) {
    const scope = this.scope();
    await plugin(scope, options as T);
  }

  decorate(name: string, value: unknown) {
    if (name in this) {
      throw new Error(`The decoration '${name}' already exists or is a reserved word.`);
    }
    Object.defineProperty(this, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }

  scope(): Velo<L> {
    return new Velo<L>(this._options, this, this.basePath);
  }
}
