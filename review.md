# Adversarial Review & Security Analysis: Velo HTTP Server

This report summarizes the security and code quality findings for the Velo HTTP server implementation against the provided specification.

## 1. Security Analysis

### 1.1 Path Traversal Protection
The implementation in `src/static.ts` is robust against path traversal attacks.
- **Multiple Layers of Defense**:
  - It explicitly checks if the request path contains `..` and throws a `ForbiddenError` immediately.
  - It uses `path.normalize()` and `path.join()` to resolve the final path.
  - It performs a `startsWith(root + sep)` check to ensure the resolved path remains within the intended root directory.
- **Windows Separator Safety**: The use of `path.posix` for URL path manipulation and `path.sep` for file system checks ensures cross-platform safety.

### 1.2 WebSocket Security (RFC 6455)
The custom WebSocket implementation in `src/websocket.ts` follows RFC 6455 security requirements:
- **Masking**: Correctly enforces that all frames from the client MUST be masked (`if (!masked) throw new Error(...)`) and ensures that frames sent from the server are NOT masked.
- **Frame Validation**: RSV bits are checked to be zero, and control frames are validated for size (<= 125 bytes) and fragmentation (must not be fragmented).
- **Handshake**: Uses the standard SHA-1 + Base64 handshake with the mandated GUID.
- **Resource Exhaustion**: `maxBufferSize` (default 1MB) is enforced on both the main data buffer and the fragmented message reassembly buffer, preventing OOM attacks from malicious clients sending infinite fragments or large payloads.

### 1.3 Request Body Protections
- **Body Limit**: Enforced during the lazy reading of the body in `src/request.ts`. It counts received bytes and throws `PayloadTooLargeError` if the limit is exceeded, preventing memory exhaustion.
- **Lazy Parsing**: Bodies are only read and parsed on demand, reducing the attack surface for unauthenticated or un-validated requests.

### 1.4 Trust Proxy Implementation
The `ip` property in `src/request.ts` follows a safer pattern by selecting the *rightmost* IP address in the `X-Forwarded-For` header when `trustProxy` is enabled. This prevents simple spoofing where a client prepends a fake IP to the header, as the last entry is the one appended by the most recent (and presumably trusted) proxy.

### 1.5 Prototype Pollution
- **Validation**: The `ObjectSchema` in `src/validation.ts` iterates over the *schema keys* rather than the *input keys*. This naturally prevents prototype pollution because it only ever accesses or assigns properties explicitly defined in the validation schema.
- **Decorate**: The `app.decorate()` method uses `Object.defineProperty` on the `Velo` instance. While this is powerful and could be used to shadow core methods (e.g., `app.decorate('listen', ...)`), it does not pollute the global `Object.prototype`.

---

## 2. Type System Review

### 2.1 Workarounds and "Escape Hatches"
While the project passes `tsc --noEmit` with zero errors, several internal mechanisms use type system workarounds:
- **Fake Response Objects**: In `src/server.ts` and `src/websocket.ts`, `null as unknown as ServerResponse` is used to create a `Response` instance for WebSocket upgrades or internal matching. The `Response` class is carefully written to check for `this.raw` before accessing native methods, but this remains a design-level workaround.
- **Internal Markers**: The `_wsHandler` is passed through the middleware pipeline by casting the context to `any` (`(ctx as any)._wsHandler`). This avoids extending the public `Context` type with internal-only properties but relies on type-safety bypass.
- **Type Assertions in Validation**: In `src/validation.ts`, many rules use `val as string` or `val as number` after a `_typeCheck`. While these are logically sound due to the preceding check, they are explicit assertions.

### 2.2 Strictness
The codebase generally adheres to a strict type system.
- **VeloRequest/VeloResponse Interfaces**: These accurately represent the available API.
- **Schema Unwrapping**: The `Unwrap<T>` and `ObjectOutput<T>` types in `src/validation.ts` provide high-quality type inference for validated data, ensuring that the results of `schema.parse()` are correctly typed without using `any`.

---

## 3. Test Case Review

### 3.1 Coverage
The test suite in `tests/` covers all 75 requirements specified in `spec.md`.
- **Router (1-9)**: Verified for static, param, wildcard, and priority rules.
- **Middleware (10-16)**: Verified for execution order, scoping, and error propagation.
- **Request (17-25)**: Verified for body parsing limits, query parsing, and trust proxy logic.
- **Response (26-33)**: Verified for status codes, headers, cookies, and streaming.
- **WebSocket (34-42)**: Verified for handshake, frame handling, and reassembly.
- **Static (43-52)**: Verified for MIME types, ETag/Range support, and path traversal.
- **Validation (53-63)**: Verified for all built-in types and middleware integration.
- **Plugin (64-69)**: Verified for registration, scoping, and decoration.
- **Server (70-75)**: Verified for lifecycle and graceful shutdown.

### 3.2 Accuracy
Tests use Node's built-in `node:test` and `node:assert`. They are empirically correct and properly reproduce the expected behavior of a low-level server.
- **Adversarial Tests**: `Static - 45. Path with .. returns 403` and `Static - 46. Dotfile with dotFiles: 'deny' returns 403` specifically target security constraints.
- **Async Handling**: Tests correctly use `await` for server lifecycle and fetch calls, ensuring no race conditions in the test suite itself.

---

## 4. Conclusion

The Velo codebase is well-engineered for a "no-dependency" project. It provides robust security protections where it matters most (path traversal, body limits, WebSocket framing) and implements a high-performance radix router as required. The use of internal type workarounds is localized and does not compromise the external API's type safety.

**Recommendations:**
- Consider defining an internal `VeloInternalContext` that extends `Context` to avoid `any` casts for markers like `_wsHandler`.
- Ensure that the `decorate` method prevents shadowing of critical server methods (`listen`, `close`, `use`) to avoid accidental sabotage by plugins.
