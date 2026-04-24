# Velo Codebase Review & Security Analysis

## 1. Security Analysis

### 1.1 Prefix-Scoped Middleware Boundary Vulnerability (CRITICAL)
In `src/server.ts`, the `getMiddlewarePipeline` method uses `path.startsWith(mw.prefix)` to determine if a middleware should run. This fails to check for path boundaries.
- **Vulnerability**: `app.use('/admin', authMiddleware)` will incorrectly execute `authMiddleware` for requests to `/administration`.
- **Impact**: This can lead to unauthorized access if developers rely on prefix-scoped middleware for security, or unexpected side effects on unrelated routes.
- **Evidence**: Confirmed with `tests/security_repro.test.ts`.

### 1.2 WebSocket Handshake & Framing (SECURE)
The WebSocket implementation in `src/websocket.ts` correctly adheres to RFC 6455:
- **Handshake**: Properly computes `Sec-WebSocket-Accept`.
- **Masking**: Correctly requires masking for client-to-server frames.
- **Frame Validation**: Checks RSV bits, opcode validity, and control frame length.
- **DoS Protection**: Implements `maxBufferSize` to prevent memory exhaustion from fragmented or large messages.
- **UTF-8 Validation**: Properly validates text frames with `fatal: true` decoder.

### 1.3 Static File Serving & Path Traversal (SECURE)
The implementation in `src/static.ts` is robust:
- **Traversal Protection**: Uses both `decodedPath.includes("..")` and a post-normalization check `fullPath.startsWith(root + sep)`.
- **Dotfiles**: Correctly implements `deny`, `ignore`, and `allow` policies.
- **URI Decoding**: Correctly decodes URI components before path processing.

### 1.4 Request IP Spoofing (MINOR)
In `src/request.ts`, `Request.ip` simply takes `ips[0]` when `trustProxy` is true.
- **Risk**: If the edge proxy does not strip incoming `X-Forwarded-For` headers, an attacker can spoof their IP by providing their own header.
- **Recommendation**: Provide an option to specify the number of trusted proxy hops.

---

## 2. Type System Review

### 2.1 Unsafe Generic Initialization
In `src/request.ts`, the `locals` property is initialized as:
```typescript
public locals: L = {} as L;
```
- **Issue**: This is a type system lie. If a user defines `Velo<{ user: string }>`, `locals` will be an empty object at runtime but typed as having a `user` property, leading to potential `undefined` errors.

### 2.2 Excessive Use of `any`
The codebase uses `any` in several key places where more specific types or generics could be used:
- `Velo<L = any>`: Defaulting to `any` reduces the effectiveness of the type system.
- `Router<T = any>`: The router's payload is often cast to `any`.
- `UnprocessableEntityError`: The `fields` property is typed as `any[]`.

### 2.3 Unsafe Type Casts
Several "make it work" casts were found:
- `handlers as Middleware[]` in `src/server.ts`.
- `this as unknown as BaseSchema<T | undefined>` in `src/validation.ts`.
- `ObjectOutput` mapping in `validation.ts` is complex and relies on several internal casts to maintain the public API.

---

## 3. Redundancy & Code Quality

### 3.1 Redundant Router Indexing
In `src/router.ts`, the `Node` class maintains an `indices` string:
```typescript
node.indices += newNode.path[0];
```
- **Issue**: This `indices` string is never read or used for lookup optimization in the `match` method. The router still iterates through the `children` array.

### 3.2 Inconsistent Socket Management
In `src/server.ts`, the `close()` method:
- Forcefully `destroy()`s WebSocket sockets.
- Relies on `server.close()` for HTTP sockets.
- **Issue**: While `server.close()` waits for connections to close, keep-alive HTTP connections can keep the server open longer than expected. The spec's "Graceful shutdown" requirement is met by Node's default behavior, but the inconsistency with WS destruction is notable.

### 3.3 Missing Error Handling in Streams
In `src/response.ts` and `src/static.ts`:
- `res.stream(readable)` pipes the stream but does not attach an error listener to the `readable`.
- **Impact**: If a file stream or other readable stream fails during transmission, it may result in an unhandled rejection or a hung connection.

---

## 4. Specification Adherence

| Requirement | Status | Note |
|-------------|--------|------|
| Radix Tree Router | Pass | Uses a proper compressed prefix tree. |
| Body Parsing Rules | Pass | Lazy, limit-enforced, once-only. |
| RFC 6455 Handshake | Pass | Correctly implemented from scratch. |
| Static Range Requests | Pass | Supports both single and multi-range. |
| Built-in Validation | Pass | No external dependencies, typed output. |
| Plugin Scoping | Pass | Routes and middleware are correctly encapsulated. |

---

## 5. Conclusion
The Velo codebase is architecturally sound and follows the specification closely. However, the **Prefix-Scoped Middleware vulnerability** is a critical security flaw that must be addressed by ensuring prefix matches occur on path boundaries (e.g., checking if the next character is a `/` or if the path is an exact match). The type system workarounds, while typical in low-level library code, should be refined to prevent runtime errors in user code.
