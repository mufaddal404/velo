import { createServer as createHttpServer, Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Request } from "./request.js";
import { Response } from "./response.js";
import { Router } from "./router.js";
import { type Middleware, type Handler, type ErrorHandler, compose, type Context } from "./middleware.js";
import { InternalServerError, NotFoundError, VeloError, MethodNotAllowedError, UnprocessableEntityError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { type WebSocketHandler, handleUpgrade as performWebSocketUpgrade } from "./websocket.js";

export interface VeloOptions {
  trustProxy?: boolean;
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

interface RouteEntry {
  handlers: Middleware[];
  scope: Velo;
}

interface VeloInternalContext extends Context {
  _wsHandler?: WebSocketHandler;
}

export class Velo<L = any> {
  public server?: HttpServer | HttpsServer;
  public router: Router<RouteEntry>;
  public wsRouter: Router<RouteEntry>;
  protected middlewares: { prefix: string; fn: Middleware<L> }[] = [];
  protected _errorHandler?: ErrorHandler<L>;
  protected _notFoundHandler?: Handler<L>;
  
  protected parent: Velo<any> | null = null;
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

  constructor(protected _options: VeloOptions = {}, parent: Velo<any> | null = null, basePath: string = "") {
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
      this.router = new Router<RouteEntry>();
      this.wsRouter = new Router<RouteEntry>();
    }
  }

  // Helper to get effective handlers, traversing lineage if necessary
  protected get errorHandler(): ErrorHandler<L> {
    if (this._errorHandler) return this._errorHandler;
    if (this.parent) return this.parent.errorHandler as ErrorHandler<L>;
    return this.defaultErrorHandler.bind(this);
  }

  protected get notFoundHandler(): Handler<L> {
    if (this._notFoundHandler) return this._notFoundHandler;
    if (this.parent) return this.parent.notFoundHandler as Handler<L>;
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
    const entry: RouteEntry = {
      handlers: [this.wrapWebSocketHandler(handler)],
      scope: this
    };
    this.wsRouter.add("GET", fullPath, entry);
    return this;
  }

  private wrapWebSocketHandler(handler: WebSocketHandler): Middleware {
    return async (ctx, next) => {
      // This is a marker for handleUpgrade to find the handler
      (ctx as VeloInternalContext)._wsHandler = handler;
      await next();
    };
  }

  private addRoute(method: string, path: string, handlers: (Handler<L> | Middleware<L>)[]) {
    const fullPath = this.basePath + path;
    const entry: RouteEntry = {
      handlers: handlers.map(h => this.wrapHandler(h)) as Middleware[],
      scope: this
    };
    this.router.add(method, fullPath, entry);
  }

  private wrapHandler(handler: Handler<L> | Middleware<L>): Middleware<L> {
    return (ctx, next) => (handler as Middleware<L>)(ctx, next);
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
      if (root._options.requestTimeout && (root.server as any).requestTimeout !== undefined) {
        (root.server as any).requestTimeout = root._options.requestTimeout;
      }
      
      root.server.on("connection", (socket: Socket) => {
        root.connections.add(socket);
        socket.on("close", () => root.connections.delete(socket));
      });
      root.server.on("secureConnection", (socket: TLSSocket) => {
        root.connections.add(socket);
        socket.on("close", () => root.connections.delete(socket));
      });
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

  async close(): Promise<void> {
    const root = this.getRoot();
    if (!root.server) return;
    
    for (const socket of root.connections) {
      if (root.wsSockets.has(socket)) {
        socket.destroy();
      }
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

  protected getRoot(): Velo<any> {
    let curr: Velo<any> = this;
    while (curr.parent) curr = curr.parent;
    return curr;
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
      
      const lineage: Velo<any>[] = [];
      let curr: Velo<any> | null = scope;
      while (curr) {
        lineage.unshift(curr);
        curr = curr.parent;
      }
      
      for (const s of lineage) {
        for (const mw of s.middlewares) {
          if (ctx.req.path.startsWith(mw.prefix)) {
            pipeline.push(mw.fn);
          }
        }
      }

      ctx.req.params = { ...ctx.req.params, ...matchInfo.result.params };
      pipeline.push(...(handlers as Middleware<L>[]));
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

    const vRes = new Response(null as unknown as ServerResponse, this._options);
    const ctx: Context<L> = { req: vReq, res: vRes };

    const pipeline: Middleware<L>[] = [];
    const lineage: Velo<any>[] = [];
    let curr: Velo<any> | null = scope;
    while (curr) {
      lineage.unshift(curr);
      curr = curr.parent;
    }

    for (const s of lineage) {
      for (const mw of s.middlewares) {
        if (vReq.path.startsWith(mw.prefix)) {
          pipeline.push(mw.fn);
        }
      }
    }

    let wsHandler: WebSocketHandler | undefined;

    pipeline.push(...(handlers as Middleware<L>[]));
    pipeline.push(async (c) => {
        wsHandler = (c as VeloInternalContext)._wsHandler;
        if (wsHandler) {
            performWebSocketUpgrade(vReq as any, socket, head, wsHandler, this._options);
        }
    });

    try {
        await compose(pipeline, ctx);
    } catch (err: unknown) {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
    }
  }

  protected async defaultErrorHandler(error: Error, ctx: Context<L>) {
    if (ctx.res.sent) return;

    const status = error instanceof VeloError ? error.status : 500;
    const message = error instanceof VeloError ? error.message : "Internal Server Error";

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

  async register<T>(plugin: Plugin<T>, options?: T) {
    const scope = this.scope();
    await plugin(scope as any, options as T);
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

  scope() {
    return new Velo(this._options, this, this.basePath);
  }
}
