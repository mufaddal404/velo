import { createServer as createHttpServer, Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
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
  https?: {
    key: string | Buffer;
    cert: string | Buffer;
    [key: string]: any;
  };
}

export class Velo {
  protected server?: HttpServer | HttpsServer;
  protected router: Router;
  protected wsRouter: Router;
  protected middlewares: { prefix: string; fn: Middleware }[] = [];
  protected _errorHandler: ErrorHandler;
  protected _notFoundHandler: Handler;
  
  protected parent: Velo | null = null;
  protected basePath: string = "";
  protected connections = new Set<any>();

  constructor(protected _options: VeloOptions = {}, parent: Velo | null = null, basePath: string = "") {
    this.parent = parent;
    this.basePath = basePath;
    
    if (parent) {
      this.router = parent.router;
      this.wsRouter = parent.wsRouter;
      this._errorHandler = parent._errorHandler;
      this._notFoundHandler = parent._notFoundHandler;
      this.connections = parent.connections;
    } else {
      this.router = new Router();
      this.wsRouter = new Router();
      this._errorHandler = this.defaultErrorHandler.bind(this);
      this._notFoundHandler = (ctx) => {
        throw new NotFoundError();
      };
    }
  }

  use(middleware: Middleware): this;
  use(prefix: string, middleware: Middleware): this;
  use(arg1: string | Middleware, arg2?: Middleware): this {
    if (typeof arg1 === "string") {
      this.middlewares.push({ prefix: this.basePath + arg1, fn: arg2! });
    } else {
      this.middlewares.push({ prefix: this.basePath, fn: arg1 });
    }
    return this;
  }

  get(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("GET", path, handlers); return this; }
  post(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("POST", path, handlers); return this; }
  put(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("PUT", path, handlers); return this; }
  patch(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("PATCH", path, handlers); return this; }
  delete(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("DELETE", path, handlers); return this; }
  options(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("OPTIONS", path, handlers); return this; }
  head(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("HEAD", path, handlers); return this; }
  all(path: string, ...handlers: (Handler | Middleware)[]) { this.addRoute("ALL", path, handlers); return this; }

  ws(path: string, handler: WebSocketHandler) {
    const fullPath = this.basePath + path;
    const handlers: any = [handler];
    handlers.scope = this;
    this.wsRouter.add("GET", fullPath, handlers);
    return this;
  }

  private addRoute(method: string, path: string, handlers: (Handler | Middleware)[]) {
    const fullPath = this.basePath + path;
    const wrappedHandlers: any = handlers.map(h => this.wrapHandler(h));
    wrappedHandlers.scope = this;
    this.router.add(method, fullPath, wrappedHandlers);
  }

  private wrapHandler(handler: Handler | Middleware): Middleware {
    if (handler.length === 2) return handler as Middleware;
    return async (ctx, next) => {
      await (handler as Handler)(ctx);
    };
  }

  group(prefix: string) {
    return new Velo(this._options, this, this.basePath + prefix);
  }

  onError(handler: ErrorHandler) {
    this._errorHandler = handler;
  }

  notFound(handler: Handler) {
    this._notFoundHandler = handler;
  }

  async listen(port: number, hostname: string = "127.0.0.1"): Promise<void> {
    const root = this.getRoot();
    if (!root.server) {
      if (root._options.https) {
        root.server = createHttpsServer(root._options.https, root.handleRequest.bind(root));
      } else {
        root.server = createHttpServer(root.handleRequest.bind(root));
      }
      
      root.server.on("connection", (socket) => {
        root.connections.add(socket);
        socket.on("close", () => root.connections.delete(socket));
      });
      root.server.on("secureConnection", (socket) => {
        root.connections.add(socket);
        socket.on("close", () => root.connections.delete(socket));
      });
      root.server.on("upgrade", (req, socket, head) => {
        (socket as any)._isWebSocket = true;
        root.connections.add(socket);
        socket.on("close", () => root.connections.delete(socket));
        root.handleUpgrade(req, socket, head);
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
      if ((socket as any)._isWebSocket) {
        socket.destroy();
      }
    }
    
    return new Promise((resolve, reject) => {
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

  protected getRoot(): Velo {
    let curr: Velo = this;
    while (curr.parent) curr = curr.parent;
    return curr;
  }

  protected async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const vReq = new Request(req, this._options);
    const vRes = new Response(res, this._options);
    const ctx: Context = { req: vReq, res: vRes };

    try {
      await this._dispatch(ctx);

      if (!vRes.sent) {
        throw new InternalServerError("Response not sent by handlers");
      }
    } catch (err: any) {
      await this._errorHandler(err, ctx);
    }
  }

  protected async _dispatch(ctx: Context) {
    const matchInfo = this.router.match(ctx.req.method, ctx.req.path);
    const pipeline: Middleware[] = [];

    if (matchInfo.result) {
      const handlers: any = matchInfo.result.handlers;
      const scope = handlers.scope as Velo;
      
      // Collect middlewares from lineage
      const lineage: Velo[] = [];
      let curr: Velo | null = scope;
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
      pipeline.push(...handlers);
    } else if (matchInfo.methodNotAllowed) {
      pipeline.push(async () => { throw new MethodNotAllowedError(); });
    } else {
      pipeline.push(async (c) => await this._notFoundHandler(c));
    }

    await compose(pipeline, ctx);
  }

  protected async handleUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
    const vReq = new Request(req, this._options);
    const matchInfo = this.wsRouter.match("GET", vReq.path);

    if (!matchInfo.result) {
      socket.destroy();
      return;
    }

    const handlers: any = matchInfo.result.handlers;
    const scope = handlers.scope as Velo;
    
    vReq.params = { ...vReq.params, ...matchInfo.result.params };
    const wsHandler = handlers[0] as WebSocketHandler;

    // Create a dummy response for middlewares that might want to use it (e.g. status)
    // However, if they call send(), we should probably fail the upgrade.
    const vRes = new Response(null as any, this._options);
    const ctx: Context = { req: vReq, res: vRes };

    const pipeline: Middleware[] = [];
    const lineage: Velo[] = [];
    let curr: Velo | null = scope;
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

    pipeline.push(async (c, next) => {
        performWebSocketUpgrade(vReq, socket, head, wsHandler);
    });

    try {
        await compose(pipeline, ctx);
    } catch (err: any) {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
    }
  }

  protected async defaultErrorHandler(error: Error, ctx: Context) {
    if (ctx.res.sent) return;

    const status = error instanceof VeloError ? error.status : 500;
    const message = error instanceof VeloError ? error.message : "Internal Server Error";

    const body: any = {
      error: message,
      status: status
    };

    if (error instanceof UnprocessableEntityError && error.fields) {
      body.fields = error.fields;
    }

    if (ctx.res.raw) {
        ctx.res.status(status).json(body);
    } else {
        // This might happen during WebSocket upgrade if middleware fails
        // We already handled it in handleUpgrade but just in case
    }
  }

  async register<T>(plugin: Plugin<T>, options?: T) {
    const scope = this.scope();
    await plugin(scope, options as T);
  }

  decorate(name: string, value: any) {
    (this as any)[name] = value;
  }

  scope() {
    return new Velo(this._options, this, this.basePath);
  }
}
