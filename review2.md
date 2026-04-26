# Code Review and Security Analysis - Velo HTTP Server

This report provides a full adversarial review and security analysis of the Velo codebase against the `@spec.md`.

## 1. Adversarial Review & Security Analysis

### 1.1 IP Spoofing via `trustProxy` (`src/request.ts`)
The current implementation of `trustProxy: true` returns the first IP in the `X-Forwarded-For` header:
```typescript
return ips[0];
```
**Vulnerability:** This is highly spoofable. An attacker can send a request with a crafted `X-Forwarded-For: <spoofed_ip>`. If the edge proxy merely appends the real client IP, the header becomes `<spoofed_ip>, <real_ip>`. Velo will trust `<spoofed_ip>`.
**Recommendation:** When `trustProxy` is a boolean `true`, it should ideally trust the entry provided by the immediate upstream proxy (the last entry) or require a specific number of hops to be secure.

### 1.2 Incomplete Slowloris Protection on Keep-Alive (`src/server.ts`)
The `setupSocketTimeout` method attaches a manual header timeout and size limit to the `connection` event.
**Vulnerability:** This manual check only runs for the *first* request on a persistent (keep-alive) connection. Subsequent requests on the same socket will not have this manual `onData` listener re-attached. While Node's native `headersTimeout` is also set, the manual redundancy is inconsistent across the connection lifecycle.

### 1.3 Missing Request Destruction on Payload Too Large (`src/request.ts`)
In the `buffer()` method, if the body exceeds the `bodyLimit`, a `PayloadTooLargeError` is thrown.
**Vulnerability:** The request stream (`this.raw`) is not destroyed. While the `for await` loop stops, the underlying socket may remain open, and the client could continue sending the remainder of the large payload, consuming network bandwidth and server processing time until the socket is eventually closed by other means.
**Recommendation:** Call `this.raw.destroy()` before throwing `PayloadTooLargeError`.

### 1.4 Loose JSON Content-Type Check (`src/request.ts`)
The `json()` method checks the `Content-Type` using `includes("application/json")`.
**Vulnerability:** This might match unexpected types like `text/x-application/json-patch` or other malicious types that shouldn't be parsed as standard JSON. A stricter check (e.g., `startsWith` or checking for the exact media type) is safer.

### 1.5 WebSocket Buffer Management (`src/websocket.ts`)
The WebSocket `handleData` uses `Buffer.concat` frequently:
```typescript
this.buffer = Buffer.concat([this.buffer, data]);
```
While protected by `maxBufferSize`, frequent small packets can lead to significant memory allocation overhead and potential DoS if an attacker sends data byte-by-byte, forcing a full buffer copy for every byte. The "Compact buffer" logic mitigates this somewhat but only after 4096 bytes.

---

## 2. Type System Review

### 2.1 Lack of Type Safety for `locals.validated` (`src/validation.ts` & `src/request.ts`)
The spec states that `ctx.req.locals.validated.body` should be "typed and safe."
**Finding:** In the current implementation, `VeloRequest.locals` defines `validated` as `Record<string, unknown>`.
```typescript
locals: Partial<L> & { validated?: Record<string, unknown> };
```
The `validate` middleware does not (and cannot easily, without complex generic composition) augment the type `L` for subsequent handlers. This means the user gets no compile-time type safety for validated data without manual casting, which contradicts the "TypeScript-first" goal of the spec.

### 2.2 Use of Type Casts
Several `as any` or `as` casts were found, mostly in `src/server.ts` for handler normalization and `src/validation.ts` for schema cloning. These are generally acceptable for low-level library code where the type system cannot express certain dynamic behaviors (like `Function.length` based dispatch).

---

## 3. Redundancy & Code Quality

### 3.1 Dynamic Middleware Pipeline Calculation (`src/server.ts`)
The `getMiddlewarePipeline` method is called on every single request and performs a full lineage walk and prefix matching.
**Finding:** This is redundant for static routes. For a high-performance server, the middleware pipeline for a specific route should ideally be pre-calculated or cached during the route registration phase.

### 3.2 Redundant URL Splitting (`src/request.ts`)
The `path` and `query` getters both call `this.raw.url.split("?")`. This is a minor redundancy but could be optimized by parsing the URL once.

### 3.3 Redundant Header Timeout Logic (`src/server.ts`)
Velo sets `root.server.headersTimeout` and also implements a manual `setupSocketTimeout`. The manual implementation is redundant and, as noted in 1.2, incomplete for keep-alive connections.

---

## 4. Test Case Review

### 4.1 Coverage Analysis
The codebase contains 84 tests, exceeding the 75 required by the spec.
- **Router:** Correctly tests static vs param priority, wildcards, and normalization.
- **WebSocket:** Excellent coverage of the RFC 6455 handshake, including edge cases like data arriving with the handshake (head buffer).
- **Static:** Comprehensive tests for path traversal, dotfiles, and complex Range requests.
- **Security:** Good proactive tests for Slowloris and connection cleanup.

### 4.2 Missing Test Scenarios
- **IP Spoofing:** There is no test verifying the security of `trustProxy` against multiple `X-Forwarded-For` entries.
- **Keep-alive Security:** Tests for Slowloris only check the first request on a connection.
- **Concurrent Body Access:** While "calling twice throws" is tested, concurrent calls to `json()` and `text()` might have race conditions that aren't explicitly tested (though the boolean flag `_bodyConsumed` handles it).

---

## Conclusion
The Velo codebase is a high-quality, strictly typed (with one notable exception) implementation of the spec. It demonstrates a deep understanding of Node.js internals and HTTP/WebSocket protocols. The most critical findings are the **IP spoofing vulnerability in `trustProxy`** and the **lack of runtime-to-compile-time type propagation for validated data**.
