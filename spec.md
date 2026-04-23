# Spec: Velo — A Low-Level Node.js HTTP Server

## Overview

Implement a low-level HTTP server library for Node.js named **Velo**.

Built directly on top of Node's `node:http` and `node:https` modules — no external
runtime dependencies whatsoever. Ships as a single importable package with a clean
TypeScript-first public API.

Target audience: developers who find Express too magic and want something closer to
the metal but without writing raw Node HTTP handlers.

---

## Project structure

```
src/
  index.ts          # public API re-exports
  server.ts         # Velo class, listen/close
  router.ts         # radix-tree router
  middleware.ts     # middleware pipeline
  request.ts        # VeloRequest wrapper
  response.ts       # VeloResponse wrapper
  websocket.ts      # WebSocket upgrade handling
  static.ts         # static file serving plugin
  validation.ts     # built-in schema validation
  plugin.ts         # plugin system
  errors.ts         # error types

tests/
  server.test.ts
  router.test.ts
  middleware.test.ts
  request.test.ts
  response.test.ts
  websocket.test.ts
  static.test.ts
  validation.test.ts
  plugin.test.ts

README.md           # full usage documentation
```

Test runner: Node's built-in `node:test` with `node:assert`. No Jest, no Vitest.
TypeScript compilation must pass with `npx tsc --noEmit` with zero errors.

---

## Core: Velo class (`src/server.ts`)

```typescript
import { Velo } from "velo"

const app = new Velo(options?: VeloOptions)

interface VeloOptions {
  trustProxy?: boolean      // trust X-Forwarded-For header, default false
  bodyLimit?: number        // max request body in bytes, default 1MB
  clock?: () => number      // injectable clock for testing, default Date.now
}

// Start listening
await app.listen(port: number, hostname?: string): Promise<void>

// Graceful shutdown — drains in-flight requests before closing
await app.close(): Promise<void>

// Routing
app.get(path, ...handlers)
app.post(path, ...handlers)
app.put(path, ...handlers)
app.patch(path, ...handlers)
app.delete(path, ...handlers)
app.options(path, ...handlers)
app.head(path, ...handlers)
app.all(path, ...handlers)   // matches any method

// Route groups
const api = app.group("/api/v1")
api.get("/users", handler)   // registers GET /api/v1/users

// Middleware
app.use(middleware)                    // global
app.use("/admin", middleware)          // prefix-scoped

// Plugin
app.register(plugin, options?)

// Error handler
app.onError(handler: ErrorHandler)

// Not found handler
app.notFound(handler: Handler)
```

---

## Routing (`src/router.ts`)

Implement a **radix tree** (compressed prefix tree) router. Linear scan over an array
is not acceptable — the router must use an actual trie structure internally.

```typescript
// Static routes
app.get("/users", handler)

// Named parameters
app.get("/users/:id", handler)
app.get("/users/:id/posts/:postId", handler)

// Wildcard
app.get("/files/*", handler)         // matches /files/a/b/c
                                     // ctx.params["*"] = "a/b/c"

// Route groups
const v1 = app.group("/api/v1")
const v2 = app.group("/api/v2")
v1.get("/ping", handler)
v2.get("/ping", handler)

// Groups can have their own middleware
const admin = app.group("/admin")
admin.use(authMiddleware)
admin.get("/dashboard", handler)
```

**Matching priority** (highest to lowest):
1. Static segments (`/users/me` beats `/users/:id` for the path `/users/me`)
2. Named parameters (`/users/:id`)
3. Wildcard (`/files/*`)

---

## Request abstraction (`src/request.ts`)

Wraps `node:http`'s `IncomingMessage`.

```typescript
interface VeloRequest {
  // Raw
  raw: IncomingMessage

  // Routing
  method: string
  path: string                          // pathname without query string
  params: Record<string, string>        // route params e.g. { id: "42" }
  query: Record<string, string | string[]>  // parsed query string

  // Headers
  headers: Record<string, string | string[]>
  header(name: string): string | undefined  // case-insensitive

  // Body — call one of these; calling both throws
  json<T = unknown>(): Promise<T>       // parses JSON body
  text(): Promise<string>               // raw text body
  buffer(): Promise<Buffer>             // raw buffer body

  // Metadata
  ip: string                            // respects trustProxy if enabled
  hostname: string                      // Host header without port
  protocol: "http" | "https"
  secure: boolean                       // protocol === "https"
  xhr: boolean                          // X-Requested-With: XMLHttpRequest

  // Cookies
  cookies: Record<string, string>       // parsed from Cookie header

  // Context bag — for passing data between middleware
  locals: Record<string, unknown>
}
```

**Body parsing rules:**
- Body is read lazily — only when `.json()`, `.text()`, or `.buffer()` is called
- Body larger than `bodyLimit` must reject with a `PayloadTooLargeError`
- Calling `.json()` on a non-JSON content-type must reject with a `BadRequestError`
- A body can only be consumed once — second call throws `BodyAlreadyConsumedError`

---

## Response abstraction (`src/response.ts`)

Wraps `node:http`'s `ServerResponse`.

```typescript
interface VeloResponse {
  // Raw
  raw: ServerResponse

  // Status
  status(code: number): this            // chainable
  getStatus(): number

  // Headers
  set(name: string, value: string): this
  get(name: string): string | undefined
  remove(name: string): this
  type(contentType: string): this       // sets Content-Type

  // Sending
  send(body?: string | Buffer | object): void
    // - object → JSON.stringify, sets Content-Type: application/json
    // - string → sets Content-Type: text/plain if not already set
    // - Buffer → sets Content-Type: application/octet-stream if not already set
    // - empty → sends with no body (204 pattern)

  json(data: unknown): void             // always sends JSON
  html(body: string): void              // Content-Type: text/html
  redirect(url: string, code?: number): void  // default 302
  stream(readable: Readable): void      // pipes a readable stream to response

  // Cookie management
  cookie(name: string, value: string, options?: CookieOptions): this
  clearCookie(name: string): this

  // State
  sent: boolean                         // true after send/json/html/redirect called
}

interface CookieOptions {
  maxAge?: number       // seconds
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "Strict" | "Lax" | "None"
  path?: string
  domain?: string
}
```

**Sending rules:**
- Calling any send method after `sent === true` must throw `ResponseAlreadySentError`
- `send()` with an object automatically sets `Content-Length`
- `stream()` must handle backpressure using `pipe`

---

## Middleware (`src/middleware.ts`)

```typescript
type Handler = (ctx: Context) => void | Promise<void>

type ErrorHandler = (
  error: Error,
  ctx: Context
) => void | Promise<void>

interface Context {
  req: VeloRequest
  res: VeloResponse
}

type Middleware = (
  ctx: Context,
  next: () => Promise<void>
) => void | Promise<void>
```

**Pipeline rules:**
- Middleware executes in registration order
- `next()` advances to the next middleware or final handler
- If a middleware does not call `next()` and does not send a response,
  the framework must send a `500` with a descriptive error
- If a middleware throws, the error propagates to `app.onError`
- If `app.onError` is not set, default error handler sends:
```json
  { "error": "Internal Server Error", "status": 500 }
```
- Prefix-scoped middleware (`app.use("/admin", mw)`) only runs for routes
  whose path starts with that prefix
- Route-level handlers are the last step in the pipeline — they are
  themselves middleware that happen to not call `next()`

---

## WebSocket support (`src/websocket.ts`)

Implement WebSocket upgrade handling from scratch using Node's `http` upgrade event.
Do not use the `ws` npm package. Implement the RFC 6455 handshake and framing.

```typescript
app.ws("/chat/:room", {
  open(ws: VeloWebSocket, ctx: Context): void
  message(ws: VeloWebSocket, data: string | Buffer): void
  close(ws: VeloWebSocket, code: number, reason: string): void
  error?(ws: VeloWebSocket, error: Error): void
})

interface VeloWebSocket {
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
  ping(data?: string): void
  readonly readyState: "open" | "closing" | "closed"
  readonly params: Record<string, string>   // route params from upgrade URL
  locals: Record<string, unknown>
}
```

**WebSocket requirements:**
- Must perform the RFC 6455 opening handshake:
  - Validate `Upgrade: websocket` and `Connection: Upgrade` headers
  - Compute `Sec-WebSocket-Accept` using SHA-1 + base64 of key + GUID
  - Reject invalid handshakes with HTTP 400
- Support text and binary frames
- Support ping/pong frames — auto-respond to ping with pong
- Handle fragmented messages (FIN bit = 0) by reassembling before delivering
- Masked frames from client must be unmasked before delivering to handler
- Clean close handshake: send close frame, wait for echo, then destroy socket
- Route parameters from the upgrade URL must be available in `ws.params`

---

## Static file serving (`src/static.ts`)

Implemented as a built-in plugin.

```typescript
app.register(staticFiles, {
  root: "./public",           // required: directory to serve from
  prefix?: "/static",         // URL prefix, default "/"
  index?: "index.html",       // directory index file, default "index.html"
  dotFiles?: "deny"           // "deny" | "ignore" | "allow", default "deny"
  maxAge?: number             // Cache-Control max-age in seconds, default 0
  etag?: boolean              // generate ETag headers, default true
})
```

**Static file requirements:**
- Serve files from `root` directory
- Set correct `Content-Type` based on file extension for at minimum:
  `.html`, `.css`, `.js`, `.ts`, `.json`, `.png`, `.jpg`, `.gif`,
  `.svg`, `.ico`, `.woff`, `.woff2`, `.pdf`, `.txt`
- Support `If-None-Match` / `ETag` — respond `304 Not Modified` when matched
- Support `Range` requests for partial content (`206 Partial Content`)
- Path traversal protection — requests containing `..` must return `403`
- `dotFiles: "deny"` returns `403` for any file or directory starting with `.`
- `dotFiles: "ignore"` returns `404`
- `dotFiles: "allow"` serves them normally
- If a directory is requested and `index` file exists, serve it
- If a directory is requested with no index file, return `404`

---

## Built-in validation (`src/validation.ts`)

A minimal schema validator — no Zod, no Joi. Implement from scratch.

```typescript
import { v } from "velo/validation"

const schema = v.object({
  name:  v.string().minLength(1).maxLength(100),
  age:   v.number().min(0).max(150).integer(),
  email: v.string().email(),
  role:  v.enum(["admin", "user", "guest"]),
  tags:  v.array(v.string()).minItems(1).maxItems(10).optional(),
  address: v.object({
    city:    v.string(),
    country: v.string().length(2),  // ISO country code
  }).optional(),
})

// Returns typed result
const result = schema.parse(unknownInput)
// { success: true, data: T } | { success: false, errors: ValidationError[] }

interface ValidationError {
  path: string       // dot-notation path e.g. "address.country"
  message: string    // human-readable e.g. "must be at most 2 characters"
  value: unknown     // the value that failed
}
```

**Supported validators:**

`v.string()` — `.minLength(n)`, `.maxLength(n)`, `.length(n)`, `.email()`,
`.url()`, `.pattern(regex)`, `.optional()`

`v.number()` — `.min(n)`, `.max(n)`, `.integer()`, `.positive()`, `.optional()`

`v.boolean()` — `.optional()`

`v.array(itemSchema)` — `.minItems(n)`, `.maxItems(n)`, `.optional()`

`v.object(shape)` — `.optional()`

`v.enum(values[])` — `.optional()`

**Middleware integration:**

```typescript
import { validate } from "velo/validation"

app.post("/users",
  validate({
    body:   userSchema,
    query:  v.object({ dryRun: v.boolean().optional() }),
    params: v.object({ id: v.string() }),
  }),
  async (ctx) => {
    // ctx.req.locals.validated.body is typed and safe
  }
)
```

- Validation errors must produce a `422 Unprocessable Entity` response:
```json
  {
    "error": "Validation failed",
    "fields": [
      { "path": "email", "message": "must be a valid email address" }
    ]
  }
```

---

## Plugin system (`src/plugin.ts`)

```typescript
type Plugin<Options = unknown> = (
  app: Velo,
  options: Options
) => void | Promise<void>

// Register a plugin
app.register(plugin, options?)

// Plugins can:
// - Register routes
// - Register middleware
// - Decorate the app instance
app.decorate("db", databaseConnection)
// Now accessible as app.db anywhere, typed via module augmentation

// Plugin encapsulation — plugins registered inside a scope
// do not leak routes or middleware to the parent
const scope = app.scope()
scope.use(scopedMiddleware)    // only applies within this scope
scope.get("/internal", handler)
await app.register(async (instance) => {
  instance.use(authMiddleware)
  instance.get("/secret", handler)
  // authMiddleware does NOT apply to routes outside this registration
})
```

---

## Error types (`src/errors.ts`)

All errors extend a base `VeloError`:

```typescript
class VeloError extends Error {
  status: number
  code: string
}

class BadRequestError extends VeloError        // 400
class UnauthorizedError extends VeloError      // 401
class ForbiddenError extends VeloError         // 403
class NotFoundError extends VeloError          // 404
class MethodNotAllowedError extends VeloError  // 405
class PayloadTooLargeError extends VeloError   // 413
class UnprocessableEntityError extends VeloError // 422
class TooManyRequestsError extends VeloError   // 429
class InternalServerError extends VeloError    // 500
class BodyAlreadyConsumedError extends VeloError  // 500
class ResponseAlreadySentError extends VeloError  // 500
```

Throwing any `VeloError` subclass inside a handler must:
- Route to `app.onError` if registered
- Otherwise respond with `{ "error": message, "status": status }` at that status code

---

## Test requirements

Each test file covers its corresponding source module.

### `tests/router.test.ts`
1. Static route matches exactly
2. Named param extracted correctly
3. Two params in one route both extracted
4. Wildcard captures remainder including slashes
5. Static segment beats param for identical path (`/users/me` vs `/users/:id`)
6. Group prefix is prepended to all routes in the group
7. `app.all()` matches GET, POST, DELETE for the same path
8. Unknown path returns 404
9. Known path with wrong method returns 405

### `tests/middleware.test.ts`
10. Global middleware runs before every handler
11. Prefix-scoped middleware only runs for matching paths
12. Middleware that throws routes to error handler
13. Middleware that skips `next()` and skips `send()` triggers 500
14. Multiple middleware run in registration order (assert execution sequence)
15. Route-level middleware runs after global middleware
16. Error handler receives the thrown error instance

### `tests/request.test.ts`
17. Query string parsed including multi-value keys (`?a=1&a=2`)
18. `header()` lookup is case-insensitive
19. `json()` parses valid JSON body
20. `json()` rejects on non-JSON content-type
21. Body larger than `bodyLimit` rejects with `PayloadTooLargeError`
22. Calling `json()` twice throws `BodyAlreadyConsumedError`
23. `cookies` parsed correctly from `Cookie` header
24. `ip` reflects `X-Forwarded-For` when `trustProxy: true`
25. `ip` ignores `X-Forwarded-For` when `trustProxy: false`

### `tests/response.test.ts`
26. `send(object)` sets `Content-Type: application/json`
27. `send(string)` sets `Content-Type: text/plain`
28. `status(201).json(data)` sends correct status and body
29. `redirect()` sends 302 and `Location` header
30. `cookie()` sets `Set-Cookie` header with correct attributes
31. `clearCookie()` sets cookie with `Max-Age=0`
32. Calling `send()` after `sent === true` throws `ResponseAlreadySentError`
33. `stream()` pipes readable to response

### `tests/websocket.test.ts`
34. Valid handshake produces correct `Sec-WebSocket-Accept`
35. Missing `Upgrade` header rejected with 400
36. `open` callback fires after successful handshake
37. Text message delivered to `message` handler
38. Binary message delivered to `message` handler
39. Ping frame triggers automatic pong response
40. Fragmented message reassembled before delivery
41. `close` callback fires with correct code and reason
42. Route params available in `ws.params`

### `tests/static.test.ts`
43. Existing file served with correct `Content-Type`
44. Non-existent file returns 404
45. Path with `..` returns 403
46. Dotfile with `dotFiles: "deny"` returns 403
47. Dotfile with `dotFiles: "ignore"` returns 404
48. Dotfile with `dotFiles: "allow"` is served
49. `ETag` header present; second request with matching `If-None-Match` returns 304
50. `Range` request returns 206 with correct byte slice
51. Directory request with index file serves the index
52. `prefix` option restricts serving to that URL prefix

### `tests/validation.test.ts`
53. Valid object passes all constraints, returns typed data
54. Missing required field returns error with correct path
55. Nested object error path uses dot notation (`address.country`)
56. `v.string().email()` rejects malformed email
57. `v.number().integer()` rejects float
58. `v.array().minItems()` rejects short array
59. `v.enum()` rejects value not in list
60. `.optional()` allows field to be absent
61. Multiple validation errors returned in one result (not fail-fast)
62. `validate()` middleware returns 422 with structured errors on failure
63. `validate()` attaches parsed data to `ctx.req.locals.validated`

### `tests/plugin.test.ts`
64. Plugin receives app instance and options
65. Plugin can register routes that are reachable
66. Plugin can register middleware that runs for its routes
67. Scoped plugin middleware does not run for routes outside the scope
68. `app.decorate()` attaches value to app instance
69. Async plugin awaited before server starts accepting requests

### `tests/server.test.ts`
70. `app.listen()` starts server and accepts connections
71. `app.close()` stops accepting new connections
72. Unhandled route returns 404 via `app.notFound` handler
73. Throwing `NotFoundError` routes to error handler not `notFound`
74. `VeloError` subclass thrown in handler responds with correct status
75. Graceful shutdown waits for in-flight request to complete

---

## README.md requirements

The README must include all of the following sections, with working code examples:

1. **Installation** — `npm install velo`
2. **Quick start** — a minimal hello-world server in under 10 lines
3. **Routing** — params, wildcards, groups, `app.all()`
4. **Middleware** — global, prefix-scoped, route-level, error handling
5. **Request** — body parsing, query, cookies, `trustProxy`
6. **Response** — send, json, redirect, stream, cookies
7. **WebSocket** — full chat room example using route params
8. **Static files** — serving a `public/` folder with ETag and dotfile rules
9. **Validation** — defining a schema, using `validate()` middleware, error shape
10. **Plugin system** — writing a plugin, scoping, `decorate()`
11. **Error handling** — custom error handler, `VeloError` subclasses
12. **TypeScript** — module augmentation example for `decorate()`

---

## What success looks like

```bash
npx tsc --noEmit          # zero TypeScript errors
node --test tests/        # all 75 tests pass
```
