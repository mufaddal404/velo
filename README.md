# Velo — A Low-Level Node.js HTTP Server

Velo is a high-performance, low-level HTTP server library for Node.js, built directly on top of the native `node:http` and `node:https` modules with zero external dependencies. It provides a modern, TypeScript-first API for developers who need maximum control without the "magic" of heavier frameworks.

---

## Table of Contents

1.  [Technical Specifications](#technical-specifications)
2.  [Architecture Overview](#architecture-overview)
3.  [Installation & Quick Start](#installation--quick-start)
4.  [Chapter 1: Routing & Radix Tree](#chapter-1-routing--radix-tree)
5.  [Chapter 2: Middleware Pipeline](#chapter-2-middleware-pipeline)
6.  [Chapter 3: Request & Response Wrappers](#chapter-3-request--response-wrappers)
7.  [Chapter 4: WebSocket (RFC 6455)](#chapter-4-websocket-rfc-6455)
8.  [Chapter 5: Static File Serving](#chapter-5-static-file-serving)
9.  [Chapter 6: Built-in Validation](#chapter-6-built-in-validation)
10. [Chapter 7: Plugin System & Decoration](#chapter-7-plugin-system--decoration)
11. [Chapter 8: Error Handling](#chapter-8-error-handling)
12. [Chapter 9: TypeScript Integration](#chapter-9-typescript-integration)
13. [Security & Performance](#security--performance)

---

## Technical Specifications

- **Runtime**: Node.js (Core modules only: `http`, `https`, `crypto`, `stream`, `fs`, `path`).
- **Dependencies**: 0 (Zero external production dependencies).
- **Router**: Compressed Prefix Tree (Radix Tree) with $O(K)$ lookup time (where $K$ is path length).
- **WebSocket**: Full RFC 6455 implementation including handshake, masking, fragmentation, and control frames.
- **Type Safety**: Built with strict TypeScript; supports generic "locals" for type-safe middleware context.
- **Performance**: Minimal overhead over raw Node.js handlers; lazy body parsing; stream-based responses.

---

## Architecture Overview

Velo follows a modular architecture centered around a core `Velo` class:

1.  **Core (`server.ts`)**: Manages the `http.Server` lifecycle, connection tracking, and graceful shutdown.
2.  **Router (`router.ts`)**: A specialized Radix Tree that handles static, parameter, and wildcard routes with strict priority rules.
3.  **Context Pipeline**: Every request generates a `Context` containing a `VeloRequest` and `VeloResponse`. This context is passed through a recursive middleware pipeline.
4.  **Plugin System**: Enables hierarchical scoping. Routes and middleware registered in a scope are encapsulated and do not leak upwards.
5.  **Abstraction Layer**: `Request` and `Response` classes wrap the native streams, providing high-level methods (`json()`, `stream()`, `cookie()`) while maintaining access to `raw` streams.

---

## Installation & Quick Start

```bash
npm install velo
```

**Minimal Hello World:**

```typescript
import { Velo } from "velo";

const app = new Velo();

app.get("/", (ctx) => {
  ctx.res.send("Hello Velo!");
});

await app.listen(3000);
console.log("Server running on http://localhost:3000");
```

---

## Chapter 1: Routing & Radix Tree

Velo's router uses a compressed prefix tree. It is significantly faster than linear array scans used in many basic routers.

### Matching Priority
1.  **Static Segments**: `/users/me`
2.  **Named Parameters**: `/users/:id`
3.  **Wildcards**: `/files/*`

### Usage Examples
```typescript
// Named parameters
app.get("/users/:id", (ctx) => {
  ctx.res.json({ userId: ctx.req.params.id });
});

// Wildcards (captured in ctx.req.params["*"])
app.get("/static/*", (ctx) => {
  ctx.res.send(`Path: ${ctx.req.params["*"]}`);
});

// Match all methods
app.all("/ping", (ctx) => ctx.res.send("pong"));

// Route Groups
const v1 = app.group("/api/v1");
v1.get("/users", (ctx) => { /* ... */ });
```

---

## Chapter 2: Middleware Pipeline

Velo uses a "Chain of Responsibility" pattern. Middleware follow the `(ctx, next) => void | Promise<void>` signature and are executed in registration order.

### Execution Order
1.  Global Middleware
2.  Prefix-scoped Middleware (matching the request path)
3.  Route-level Middleware
4.  Final Handler

### Examples
```typescript
// Global middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.req.method} ${ctx.req.path} - ${Date.now() - start}ms`);
});

// Prefix-scoped middleware
app.use("/admin", authMiddleware);

// Route-level middleware
app.get("/secret", secretMiddleware, (ctx) => {
  ctx.res.send("shhh!");
});
```

---

## Chapter 3: Request & Response Wrappers

### VeloRequest
Wraps Node's `IncomingMessage` with convenient helpers and lazy parsing.

```typescript
app.post("/data", async (ctx) => {
  // Body parsing (Lazy: reads stream only when called)
  const body = await ctx.req.json(); // or .text(), .buffer()
  
  // Metadata & Headers
  const query = ctx.req.query;
  const cookie = ctx.req.cookies.session;
  const userAgent = ctx.req.header("user-agent");
  
  console.log(ctx.req.ip, ctx.req.hostname, ctx.req.protocol);
  console.log(`Secure: ${ctx.req.secure}, XHR: ${ctx.req.xhr}`);
});
```

### VeloResponse
Wraps Node's `ServerResponse` with a chainable API.

```typescript
app.get("/res", (ctx) => {
  ctx.res
    .status(201)
    .type("application/json")
    .cookie("pref", "dark", { httpOnly: true, secure: true, sameSite: "Lax" })
    .send({ ok: true });
});

// Redirects
ctx.res.redirect("/login");

// Streaming with backpressure handling
ctx.res.stream(fs.createReadStream("large-file.zip"));
```

---

## Chapter 4: WebSocket (RFC 6455)

Velo implements the WebSocket protocol from scratch, providing full access to route parameters and locals during the upgrade.

```typescript
app.ws("/chat/:room", {
  open(ws, ctx) {
    ws.locals.user = "Anonymous";
    console.log(`Joined room: ${ws.params.room}`);
  },
  message(ws, data) {
    // data can be string or Buffer
    ws.send(`Echo: ${data}`);
  },
  close(ws, code, reason) {
    console.log(`Left room: ${ws.params.room} (Code: ${code})`);
  }
});
```
**Features**: Handshake validation, automatic Pong responses to Pings, fragmented message reassembly, and frame unmasking.

---

## Chapter 5: Static File Serving

Implemented as a built-in plugin with security at its core.

```typescript
import { staticFiles } from "velo";

app.register(staticFiles, {
  root: "./public",           // Directory to serve from
  prefix: "/static",          // URL prefix
  index: "index.html",        // Default file
  dotFiles: "deny",           // "deny" | "ignore" | "allow"
  maxAge: 3600,               // Cache-Control
  etag: true                  // Support for 304 Not Modified
});
```
**Security**: Path traversal protection (detects `..`), boundary checks, and `Range` request limits.

---

## Chapter 6: Built-in Validation

Fast, schema-based validation with zero dependencies.

```typescript
import { v, validate } from "velo";

const userSchema = v.object({
  username: v.string().minLength(3).maxLength(20),
  email:    v.string().email(),
  role:     v.enum(["admin", "user", "guest"]),
  age:      v.number().min(18).optional()
});

app.post("/register", validate({ body: userSchema }), (ctx) => {
  // ctx.req.locals.validated.body is fully typed
  const { username, email } = ctx.req.locals.validated.body;
  ctx.res.send(`Registered ${username}`);
});
```
Validation failures automatically return a `422 Unprocessable Entity` with structured error paths.

---

## Chapter 7: Plugin System & Decoration

Modularize your application and extend the server instance.

### Plugins & Scoping
```typescript
const myPlugin = async (app, options) => {
  app.get("/plugin-route", (ctx) => ctx.res.send(options.msg));
};

app.register(myPlugin, { msg: "Hello from plugin" });

// Scoped plugins: routes and middleware do not leak to the parent
await app.register(async (instance) => {
  instance.use(authMiddleware);
  instance.get("/private", (ctx) => ctx.res.send("Secret area"));
});
```

### Decoration
```typescript
app.decorate("db", databaseConnection);
// Accessible as app.db throughout the application
```

---

## Chapter 8: Error Handling

Velo uses a hierarchical error handling system with dedicated `VeloError` subclasses.

```typescript
import { NotFoundError, UnauthorizedError } from "velo";

app.get("/secret", () => {
  throw new UnauthorizedError("Keep out!");
});

app.onError((err, ctx) => {
  if (err instanceof UnauthorizedError) {
    ctx.res.status(401).json({ error: "No entry", hint: err.message });
    return;
  }
  // Default fallback
  ctx.res.status(500).json({ error: "Internal Server Error" });
});
```

---

## Chapter 9: TypeScript Integration

Velo is built for TypeScript. Use module augmentation to type your decorations and custom locals.

```typescript
declare module "velo" {
  interface Velo {
    db: MyDatabaseClient;
  }
  interface VeloRequest {
    user?: { id: string; name: string };
  }
}

app.decorate("db", db);
```

---

## Security & Performance

- **Graceful Shutdown**: `app.close()` drains in-flight HTTP requests while immediately cleaning up WebSocket connections.
- **DoS Mitigation**: 
    - `headersTimeout` and `MAX_HEADER_SIZE` limits.
    - `bodyLimit` enforcement (default 1MB).
    - `maxRanges` limits in static serving to prevent range-based CPU exhaustion.
- **Path Traversal**: Multi-layered URI decoding and path boundary checks in the static file plugin.
- **Trust Proxy**: Support for `X-Forwarded-For` and `X-Forwarded-Proto` with configurable hop trust.

---

## License
MIT
