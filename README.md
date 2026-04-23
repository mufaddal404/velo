# Velo

A low-level, high-performance HTTP server library for Node.js with zero dependencies.

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
console.log("Server running on http://localhost:3000");
```

## Routing

Velo uses a radix tree router for efficient path matching. It supports static routes, named parameters, and wildcards.

```typescript
// Named parameters
app.get("/users/:id", (ctx) => {
  const id = ctx.req.params.id;
  ctx.res.json({ id });
});

// Wildcards
app.get("/files/*", (ctx) => {
  const path = ctx.req.params["*"];
  ctx.res.send(`Accessing ${path}`);
});

// Route groups
const api = app.group("/api/v1");
api.get("/ping", (ctx) => ctx.res.send("pong"));
```

## Middleware

```typescript
// Global middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.req.method} ${ctx.req.path} - ${Date.now() - start}ms`);
});

// Prefix-scoped middleware
app.use("/admin", authMiddleware);
```

## WebSocket

Velo includes a built-in RFC 6455 compliant WebSocket implementation.

```typescript
app.ws("/chat/:room", {
  open(ws, ctx) {
    console.log(`User joined ${ws.params.room}`);
  },
  message(ws, data) {
    ws.send(`Echo: ${data}`);
  },
  close(ws, code, reason) {
    console.log("Closed", code, reason);
  }
});
```

## Static Files

```typescript
import { staticFiles } from "velo/static";

app.register(staticFiles, {
  root: "./public",
  prefix: "/static"
});
```

## Validation

Built-in minimal schema validator.

```typescript
import { v, validate } from "velo/validation";

const userSchema = v.object({
  name: v.string().minLength(2),
  age: v.number().min(0)
});

app.post("/users", validate({ body: userSchema }), (ctx) => {
  const user = ctx.req.locals.validated.body;
  ctx.res.status(201).json(user);
});
```

## Error Handling

```typescript
import { ForbiddenError } from "velo";

app.get("/secret", (ctx) => {
  throw new ForbiddenError("Not allowed here");
});

app.onError((err, ctx) => {
  ctx.res.status(500).json({ custom: "error" });
});
```

## TypeScript Decorators

You can decorate the app instance and maintain type safety.

```typescript
declare module "velo" {
  interface Velo {
    db: DatabaseConnection;
  }
}

app.decorate("db", myDbConnection);
```
