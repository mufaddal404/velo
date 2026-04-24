# Velo — A Low-Level Node.js HTTP Server

Velo is a high-performance, low-level HTTP server library for Node.js, built directly on top of the native `http` and `https` modules with zero external dependencies.

## Installation

```bash
npm install velo
```

## Quick Start

```typescript
import { Velo } from "velo";

const app = new Velo();

app.get("/", (ctx) => {
  ctx.res.send("Hello Velo!");
});

await app.listen(3000);
```

## Routing

Velo uses a high-performance radix tree router.

```typescript
// Named parameters
app.get("/users/:id", (ctx) => {
  ctx.res.json({ userId: ctx.req.params.id });
});

// Wildcards
app.get("/static/*", (ctx) => {
  ctx.res.send(`Path: ${ctx.req.params["*"]}`);
});

// Match all methods
app.all("/ping", (ctx) => ctx.res.send("pong"));

// Route groups
const v1 = app.group("/api/v1");
v1.get("/users", (ctx) => { /* ... */ });
```

## Middleware

Middlewares follow the `(ctx, next) => void | Promise<void>` signature.

```typescript
// Global middleware
app.use(async (ctx, next) => {
  console.log(`${ctx.req.method} ${ctx.req.path}`);
  await next();
});

// Prefix-scoped middleware
app.use("/admin", authMiddleware);

// Route-level middleware
app.get("/secret", secretMiddleware, (ctx) => {
  ctx.res.send("shhh!");
});
```

## Request

Wraps Node's `IncomingMessage` with convenient helpers.

```typescript
app.post("/data", async (ctx) => {
  const body = await ctx.req.json(); // or .text(), .buffer()
  const query = ctx.req.query;
  const cookie = ctx.req.cookies.session;
  const userAgent = ctx.req.header("user-agent");
  
  console.log(ctx.req.ip, ctx.req.hostname, ctx.req.protocol);
});
```

## Response

Wraps Node's `ServerResponse` with a chainable API.

```typescript
app.get("/res", (ctx) => {
  ctx.res
    .status(201)
    .type("application/json")
    .cookie("pref", "dark", { httpOnly: true })
    .send({ ok: true });
});

// Redirects
ctx.res.redirect("/login");

// Streaming
ctx.res.stream(fs.createReadStream("large-file.zip"));
```

## WebSocket

RFC 6455 compliant WebSockets without external dependencies.

```typescript
app.ws("/chat/:room", {
  open(ws, ctx) {
    ws.locals.user = "Anonymous";
    console.log(`Joined room: ${ws.params.room}`);
  },
  message(ws, data) {
    ws.send(`Echo: ${data}`);
  },
  close(ws, code, reason) {
    console.log(`Left room: ${ws.params.room}`);
  }
});
```

## Static Files

Built-in static file serving with ETag, Range support, and security features.

```typescript
import { staticFiles } from "velo";

app.register(staticFiles, {
  root: "./public",
  prefix: "/static",
  dotFiles: "deny",
  index: "index.html",
  maxAge: 3600
});
```

## Validation

Fast, built-in schema validation.

```typescript
import { v, validate } from "velo";

const schema = v.object({
  email: v.string().email(),
  age: v.number().min(18).optional()
});

app.post("/register", validate({ body: schema }), (ctx) => {
  const data = ctx.req.locals.validated.body;
  // data is fully typed
});
```

## Plugin System

Modularize your application using plugins and scopes.

```typescript
// Define a plugin
const myPlugin = async (app, options) => {
  app.get("/plugin-route", (ctx) => ctx.res.send(options.msg));
};

// Register with options
app.register(myPlugin, { msg: "Hello from plugin" });

// Scoped plugins (middleware/routes don't leak out)
await app.register(async (instance) => {
  instance.use(authMiddleware);
  instance.get("/private", (ctx) => { /* ... */ });
});
```

## Error Handling

Customizable error handling with built-in error types.

```typescript
import { NotFoundError } from "velo";

app.get("/missing", () => {
  throw new NotFoundError("Not here!");
});

app.onError((err, ctx) => {
  if (err instanceof NotFoundError) {
    ctx.res.status(404).json({ error: "Custom 404" });
    return;
  }
  ctx.res.status(500).json({ error: "Internal Error" });
});
```

## TypeScript

Extend the Velo types for your application.

```typescript
declare module "velo" {
  interface Velo {
    db: any;
  }
  interface VeloRequest {
    user?: { id: string };
  }
}

app.decorate("db", db);
```
