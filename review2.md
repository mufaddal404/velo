# Code Review and Security Analysis: Velo HTTP Server

## 1. Security Analysis (Adversarial Review)

### 1.1. WebSocket Security
- **Missing Handshake Validation**: In `src/websocket.ts`, the `handleUpgrade` function does not verify the `Sec-WebSocket-Version` header. RFC 6455 (Section 4.2.1) explicitly states that the request MUST contain this header with a value of `13`. Failing to check this can lead to compatibility issues or unexpected behavior with older/non-standard clients.
- **Buffer Overflow Protection**: The implementation correctly uses `maxBufferSize` (default 1MB) to limit the amount of data buffered for fragmented messages and overall socket buffering. This is a good defense against memory exhaustion attacks.
- **UTF-8 Validation**: The use of `TextDecoder` with `{ fatal: true }` in `deliverMessage` correctly handles invalid UTF-8 sequences by closing the connection with code `1007`, as required by the RFC.
- **Masking Requirement**: The server correctly enforces that all client-to-server frames MUST be masked, throwing an error if they are not.

### 1.2. Static File Serving Security
- **Path Traversal Protection**: `src/static.ts` implements two layers of protection:
  1. An explicit check for `..` in the decoded path.
  2. A `normalize` + `startsWith(root)` check after joining the path with the root directory.
  This is a robust defense against path traversal.
- **Dotfile Protection**: The `dotFiles` option ("deny", "ignore", "allow") is correctly implemented and defaults to "deny", which is secure.
- **Multipart Range DOS (Vulnerability)**: The server supports `multipart/byteranges` for multiple `Range` requests but does not limit the number of ranges allowed in a single request. An attacker could send a request with thousands of small, overlapping, or disjoint ranges, forcing the server to perform excessive disk I/O and CPU-intensive multipart body generation.

### 1.3. Request Handling Security
- **Body Limit**: The `Request.buffer()` method correctly enforces `options.bodyLimit`, preventing large payload DOS attacks.
- **Trust Proxy**: The implementation of `trustProxy` as a boolean or a number (hop count) for both `ip` and `protocol` is correct and follows industry standards.

---

## 2. Code Quality & Type System Review

### 2.1. Type System "Workarounds"
- **Generics and `any`**: The use of `Velo<L = any>` is appropriate for a middleware-based framework where the user-defined `locals` shape is unknown.
- **Fluent API Type Casting**: In `src/validation.ts`, `return this as unknown as BaseSchema<T | undefined>` in the `optional()` method is a standard pattern for fluent APIs in TypeScript to change the return type without changing the runtime object.
- **Compatibility Hooks**: In `src/server.ts`, `(root.server as any).closeIdleConnections()` is used to safely call a method that may not exist in older Node.js versions.
- **Strict Typing**: The codebase generally adheres to a strict type system. However, the `validate` middleware in `src/validation.ts` injects a `validated` property into `ctx.req.locals`. If a user provides a strict type for `L` that doesn't include `validated`, they will encounter TypeScript errors when accessing it, even though the spec suggests it should be "typed and safe."

### 2.2. Functional Bugs
- **Cookie Decoding Mismatch**: `src/request.ts` parses cookies by splitting strings but does NOT use `decodeURIComponent`. Conversely, `src/response.ts` uses `encodeURIComponent` when setting cookies. This results in a bug where any cookie with special characters (e.g., spaces, symbols) cannot be correctly read back by the server.

### 2.3. Redundancy and Optimization
- **Middleware Pipeline Calculation**: `src/server.ts` calculates the middleware pipeline for every request by traversing the app lineage in `getMiddlewarePipeline`. For high-performance servers, this could be pre-calculated and cached for each route.
- **Path Normalization**: Both `Velo` and `Router` have logic for handling paths, though the `Router`'s `normalizePath` is the source of truth for matching.

---

## 3. Test Case Review

### 3.1. Coverage Analysis
- The test suite covers all 75 requirements specified in `@spec.md`.
- **WebSocket Reassembly**: `tests/websocket.test.ts` correctly verifies that fragmented messages are reassembled before delivery.
- **Static File Traversal**: `tests/static.test.ts` includes tests for both simple `..` and URL-encoded `%2e%2e` traversal.
- **Validation**: `tests/validation.test.ts` covers nested objects, arrays, and various constraints.

### 3.2. Missing Test Scenarios
- **Sec-WebSocket-Version**: There is no test verifying that the server rejects invalid WebSocket versions (because the implementation currently doesn't check it).
- **Cookie Decoding**: There is no test case in `tests/request.test.ts` that specifically verifies if cookies with encoded characters are correctly decoded.
- **Range Request Limit**: There are no tests for a very large number of ranges in a single request.

---

## 4. Final Verdict

The codebase is well-structured and implements a low-level HTTP server with high fidelity to the spec. The radix tree router is efficient, and the WebSocket implementation from scratch is impressive.

**Critical Findings to Address:**
1. Fix the cookie parsing bug by adding `decodeURIComponent` in `src/request.ts`.
2. Implement a check for `Sec-WebSocket-Version: 13` in `src/websocket.ts`.
3. Add a limit to the number of allowed ranges in `src/static.ts` to prevent DOS.
4. (Optional) Improve the type safety of `ctx.req.locals.validated` by allowing it to be part of the `VeloRequest` interface or providing a better extension mechanism.
