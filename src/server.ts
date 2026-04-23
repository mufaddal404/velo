import { createServer, Server, IncomingMessage, ServerResponse } from "node:http";
import { Request } from "./request.js";
import { Response } from "./response.js";
import { Router } from "./router.js";
import { type Middleware, type Handler, type ErrorHandler, compose, type Context } from "./middleware.js";
import { InternalServerError, NotFoundError, VeloError, MethodNotAllowedError, UnprocessableEntityError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { type WebSocketHandler, handleUpgrade } from "./websocket.js";

export interface VeloOptions {
  trustProxy?: boolean;
  bodyLimit?: number;
  clock?: () => number;
}

export class Velo {
  protected server?: Server;
  protected router = new Router();
  protected wsRouter = new Router();
  protected middlewares: { prefix: string; fn: Middleware }[] = [];
  protected _errorHandler: ErrorHandler = this.defaultErrorHandler.bind(this);
  protected _notFoundHandler: Handler = (ctx) => {
    throw new NotFoundError();
  };
  
  constructor(protected _options: VeloOptions = {}) {
  }

  use(middleware: Middleware): this;
  use(prefix: string, middleware: Middleware): this;
  use(arg1: string | Middleware, arg2?: Middleware): this {
    if (typeof arg1 === "string") {
      this.middlewares.push({ prefix: arg1, fn: arg2! });
    } else {
      this.middlewares.push({ prefix: "/", fn: arg1 });
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
    this.wsRouter.add("GET", path, [handler]);
    return this;
  }

  private addRoute(method: string, path: string, handlers: (Handler | Middleware)[]) {
    this.router.add(method, path, handlers.map(h => this.wrapHandler(h)));
  }

  private wrapHandler(handler: Handler | Middleware): Middleware {
    if (handler.length === 2) return handler as Middleware;
    return async (ctx, next) => {
      await (handler as Handler)(ctx);
    };
  }

  group(prefix: string) {
    return {
      get: (path: string, ...handlers: (Handler | Middleware)[]) => this.get(prefix + path, ...handlers),
      post: (path: string, ...handlers: (Handler | Middleware)[]) => this.post(prefix + path, ...handlers),
      put: (path: string, ...handlers: (Handler | Middleware)[]) => this.put(prefix + path, ...handlers),
      patch: (path: string, ...handlers: (Handler | Middleware)[]) => this.patch(prefix + path, ...handlers),
      delete: (path: string, ...handlers: (Handler | Middleware)[]) => this.delete(prefix + path, ...handlers),
      options: (path: string, ...handlers: (Handler | Middleware)[]) => this.options(prefix + path, ...handlers),
      head: (path: string, ...handlers: (Handler | Middleware)[]) => this.head(prefix + path, ...handlers),
      all: (path: string, ...handlers: (Handler | Middleware)[]) => this.all(prefix + path, ...handlers),
      ws: (path: string, handler: WebSocketHandler) => this.ws(prefix + path, handler),
      use: (middleware: Middleware) => {
        this.use(prefix, middleware);
        return this;
      }
    };
  }

  onError(handler: ErrorHandler) {
    this._errorHandler = handler;
  }

  notFound(handler: Handler) {
    this._notFoundHandler = handler;
  }

  async listen(port: number, hostname?: string): Promise<void> {
    if (!this.server) {
      this.server = createServer(this.handleRequest.bind(this));
      this.server.on("upgrade", this.handleUpgrade.bind(this));
    }
    return new Promise((resolve) => {
      this.server!.listen(port, hostname, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
  }

  protected async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const vReq = new Request(req, this._options);
    const vRes = new Response(res);
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

    // Add matching middlewares
    for (const mw of this.middlewares) {
      if (ctx.req.path.startsWith(mw.prefix)) {
        pipeline.push(mw.fn);
      }
    }

    if (matchInfo.result) {
      ctx.req.params = { ...ctx.req.params, ...matchInfo.result.params };
      pipeline.push(...matchInfo.result.handlers);
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

    vReq.params = matchInfo.result.params;
    const handler = matchInfo.result.handlers[0] as WebSocketHandler;
    handleUpgrade(vReq, socket, head, handler);
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

    ctx.res.status(status).json(body);
  }

  async register<T>(plugin: Plugin<T>, options?: T) {
    await plugin(this, options as T);
  }

  decorate(name: string, value: any) {
    (this as any)[name] = value;
  }

  scope() {
    return this; // Simplified for now
  }
}
