# Adversarial Review and Security Analysis: Velo HTTP Server

This report documents the findings from a full adversarial review and security analysis of the Velo codebase against the provided `@spec.md`.

## 1. Security & Adversarial Findings

### 1.1. Path Traversal & Encoding Vulnerabilities (`src/static.ts`)
*   **Missing URI Decoding:** The static file server does not call `decodeURIComponent` on the request path.
    *   **Impact:** Files with spaces, non-ASCII characters, or reserved characters in their names cannot be served if the client URL-encodes them.
    *   **Security Risk:** While the current implementation uses `normalize` and `startsWith(root)` which mitigates basic traversal, the lack of decoding means that checks for `..` can be bypassed if the OS or a subsequent layer decodes `%2e%2e` after the application's string-based check `ctx.req.path.includes("..")`. 
*   **Dotfile Protection:** The check `parts.some((p) => p.startsWith("."))` is performed on the encoded path. An attacker might use `%2e` to bypass this check if the subsequent file system call decodes it.

### 1.2. WebSocket RFC 6455 Non-Compliance (`src/websocket.ts`)
*   **Invalid UTF-8 in Text Frames:** The `deliverMessage` function calls `payload.toString("utf8")` for text frames (opcode 0x01) without validating the UTF-8 sequence.
    *   **Impact:** According to RFC 6455 Section 8.1, if a client sends a text frame containing invalid UTF-8, the server **must** fail the connection with status code 1007. The current implementation will either produce replacement characters or throw an unhandled exception depending on the environment.
*   **Loose Handshake Verification:** The `Connection` header check `connection?.toLowerCase().includes("upgrade")` is slightly more permissive than required, though generally acceptable in practice.

### 1.3. Cookie Injection (`src/response.ts`)
*   **Lack of Value Escaping:** The `cookie()` method concatenates name and value without any escaping: ``let str = `${name}=${value}`;``.
    *   **Impact:** If an application passes user-controlled data to `res.cookie()`, an attacker can inject additional cookie attributes (e.g., `; HttpOnly; Secure`) or even multiple cookies by including `;` or `=` in the value.
    *   **Example:** `res.cookie('session', 'val; Domain=evil.com')` would result in a cookie scoped to a different domain.

### 1.4. IP Spoofing / Misinterpretation (`src/request.ts`)
*   **X-Forwarded-For Handling:** The `ip` getter uses `ips[ips.length - 1]` when `trustProxy` is true.
    *   **Impact:** This returns the *last* IP in the chain, which is the IP of the client that connected to the *last* proxy. While this is one interpretation of "respecting" the header, many developers expect the *original* client IP (the first one in the list). If a client sends a spoofed `X-Forwarded-For` and the proxy appends to it, the current implementation might return a proxy IP instead of the client IP, or vice versa depending on the proxy configuration.

### 1.5. Denial of Service (DoS) Potentials
*   **Slowloris / Timeout Management:** The server does not explicitly set headers or socket timeouts (e.g., `keepAliveTimeout`, `headersTimeout`) on the Node.js HTTP server. This makes it vulnerable to Slowloris-style attacks where connections are kept open indefinitely by sending data very slowly.

---

## 2. Type System Integrity Review

The codebase contains several "workarounds" and patches that undermine the strictness of the type system.

### 2.1. Use of `any` and Type Assertions
*   **`src/plugin.ts`:** Uses `Options = any`. This should be `unknown` to force plugins to define their options properly.
*   **`src/server.ts`:** 
    *   `InternalHandlers` extends `Array<Middleware>` but adds a `scope` property. This is a runtime decoration that is "forced" into the type system via `handlers as InternalHandlers`.
    *   `null as unknown as ServerResponse` in `handleUpgrade`. This is a major type safety violation. It creates a `Response` object where `raw` is `null`, which will cause runtime crashes if methods like `ctx.res.set()` or `ctx.res.status()` are called within WebSocket middleware or error handlers.
*   **`src/validation.ts`:** 
    *   Heavy use of `as T`, `val as unknown[]`, and `data as Output<T>`. While some casting is inevitable in a validator, the implementation relies on it heavily rather than using type guards.
    *   `optional()` uses `this as unknown as BaseSchema<T | undefined>`, which is a common but technically "patchy" builder pattern.

### 2.2. Weak Context Typing
*   **`ctx.req.locals`:** Defined as `Record<string, unknown>`.
    *   **Impact:** The `validate` middleware attaches data to `ctx.req.locals.validated`, but consumers have no type-safe way to access this without further casting or manual type definitions. This violates the "TypeScript-first public API" goal.

### 2.3. Test Suite Workarounds
*   Almost every test file uses `(app as any)` to access internal properties like `server` or `router`.
*   Handlers in tests frequently use `(ctx: any)`, bypassing the very `Context` type the library is supposed to provide.
*   **Conclusion:** The tests do not verify the library's type safety for end-users; they only verify runtime behavior by bypassing the type system.

---

## 3. Test Coverage Review

All 75 test cases specified in the `@spec.md` are implemented.

### 3.1. Correctness of Tests
*   **Positive:** The tests cover a wide range of scenarios, including edge cases like `dotFiles` rules, `Range` requests, and WebSocket fragmentation.
*   **Negative:** The tests are "blind" to type errors. If the `Velo` class had a breaking change in its public API types, the tests would still pass because of the heavy use of `any`.

### 3.2. Missing Test Scenarios
*   **Invalid UTF-8 in WebSockets:** No test case verifies the behavior when a text frame contains invalid UTF-8.
*   **Cookie Injection:** No test case checks for semicolon injection in cookies.
*   **Concurrent Body Access:** While "calling `json()` twice" is tested, concurrent calls to `json()` and `text()` might lead to race conditions not captured by the simple `_bodyConsumed` flag (though `await` helps).
*   **Middleware Execution with `null` ServerResponse:** There are no tests verifying that `ctx.res` methods fail gracefully (or at least predictably) when used during a WebSocket upgrade.

---

## 4. Summary of Recommendations

1.  **Sarden Static Server:** Add `decodeURIComponent` and improve path traversal checks to handle encoded characters.
2.  **Strict WebSocket Compliance:** Implement UTF-8 validation for text frames and handle handshake headers more strictly.
3.  **Sanitize Cookies:** Escape semicolons and equals signs in cookie names and values.
4.  **Refactor Types:** 
    *   Replace `any` with `unknown` or specific generics.
    *   Remove the `null as unknown as ServerResponse` hack; instead, define a `WebSocketContext` or ensure `Response` can handle a missing `raw` property safely.
    *   Provide a way for users to provide custom types for `ctx.req.locals` (e.g., via generics on the `Velo` class).
5.  **Clean up Tests:** Remove `as any` from tests to ensure the public API is actually usable in a strict TypeScript environment.
