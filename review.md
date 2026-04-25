# Velo Code Review & Security Analysis

## 1. Adversarial Review & Security Analysis

### Path Traversal (src/static.ts)
- **Finding**: Multi-layered protection is used:
    1. Pre-normalization check for `..` in decoded URI.
    2. `path.normalize()` used on joined path.
    3. Final check that `fullPath` starts with the resolved `root` directory using `sep` to prevent partial name matches (e.g., `/var/www` vs `/var/www-secret`).
- **Security Rating**: **Safe**. The implementation is robust against common path traversal attacks.

### WebSocket Implementation (src/websocket.ts)
- **Finding**: Custom implementation of RFC 6455.
- **Security Features**:
    - **Buffer Limits**: `maxBufferSize` (1MB default) enforced for reassembly and fragmentation.
    - **Masking**: Mandatory for client-to-server frames as per RFC.
    - **Control Frame Validation**: Ensures control frames are not fragmented and have length <= 125.
    - **UTF-8 Validation**: Text frames are validated during decoding; failure results in 1007 (Invalid Frame Payload Data).
- **Security Rating**: **Safe**. The implementation handles the complex requirements of RFC 6455 securely.

### Denial of Service (DoS)
- **Slowloris Mitigation**: `src/server.ts` uses both Node's built-in `headersTimeout` and a custom `setupSocketTimeout` that manually checks for header completion (`\r\n\r\n`). 
- **Payload Limits**: `bodyLimit` is correctly enforced in `src/request.ts` during lazy body reading and in WebSocket frame processing.
- **Range Request DoS**: `src/static.ts` limits the number of ranges (`maxRanges: 10`) to prevent resource exhaustion attacks.
- **Backpressure Issue (src/static.ts)**: **Vulnerability Detected**. In the multipart range handling, `out.write()` is called without checking its return value or waiting for 'drain'. A slow client combined with a large file and multiple ranges could cause unbounded memory growth in the `PassThrough` buffer.
- **Security Rating**: **Good (with one caveat)**. The backpressure issue in multipart ranges should be addressed.

### IP Spoofing & Trust Proxy
- **Finding**: `trustProxy` implementation correctly handles both boolean (trust last) and number (hop count).
- **Security Rating**: **Safe**. Standard implementation for proxy-aware IP extraction.

## 2. Type System Review

### Type System Workarounds & "Hacks"
The codebase contains several instances of type assertions and `any` usage to bypass the type system or "make the code just work":

1. **src/validation.ts**: `_rules` array is typed as `((val: any, path: string) => ValidationError | null)[]`. The use of `any` here bypasses type checking for individual validator rules.
2. **src/server.ts**: In `addRoute`, handlers are cast using `handlers as Middleware<L>[]`. This is because `addRoute` accepts both `Handler` (1 arg) and `Middleware` (2 args). While functional in JS, it "lies" to the middleware composer about the signature of the handlers.
3. **src/response.ts**: `json(data: unknown)` method calls `this.send(data as string | Buffer | object)`. This cast is necessary because `send` has a narrower signature than `unknown`.
4. **src/request.ts**: `this.raw.headers as Record<string, string | string[]>` is used to satisfy the interface, as Node's `IncomingHttpHeaders` is slightly different.
5. **src/server.ts**: `(ctx as VeloInternalContext<L>)` is used in `wrapWebSocketHandler` to attach an internal `_wsHandler` marker, which is then retrieved in `handleUpgrade`.

**Verdict**: The type system is mostly strict, but these workarounds indicate areas where the architectural design (like mixing Handlers and Middleware or internal markers) forced type-safety compromises.

## 3. Redundancy & Code Quality

### Duplicated Logic
- **Lineage Traversal**: `Velo` class implements `getLineage()`, `getRoot()`, `errorHandler`, and `notFoundHandler` which all traverse the parent chain. This could be consolidated.
- **Header Parsing**: `src/server.ts` manually parses headers for `\r\n\r\n` to implement a timeout, which is partially redundant with Node's native `headersTimeout`.
- **Static Path Check**: `src/static.ts` checks for `..` before calling `normalize()`. `normalize()` followed by a `startsWith(root)` check is sufficient and more robust.

### Redundant Code
- **Router Separation**: Using separate `router` and `wsRouter` is clean but leads to some duplicated logic in `Velo` for adding routes vs adding WS handlers.

## 4. Adherence to @spec.md

- **Radix Tree Router**: **Fully Compliant**. Implements node splitting and proper matching priority (Static > Param > Wildcard).
- **Zero Dependencies**: **Fully Compliant**. Only Node.js built-in modules are used.
- **WebSocket**: **Fully Compliant**. Implements the full handshake and framing from scratch.
- **Static Files**: **Fully Compliant**. Supports all required MIME types, ETags, and Range requests.
- **Validation**: **Fully Compliant**. Builder-style API works as specified.
- **Plugin System**: **Fully Compliant**. Supports `decorate()` and encapsulation via `scope()`.

## 5. Test Case Review

### Coverage
- **Total Tests**: 102 tests.
- **Spec Coverage**: All 75 mandatory test cases from `@spec.md` are implemented and numbered (e.g., `Router - 1.`, `Static - 43.`).
- **Effectiveness**: The tests use `node:test` and `node:assert`. They effectively cover both happy paths and error conditions (404, 405, 413, 422, etc.).
- **Missing Tests**: No significant functionality from the spec is missing tests. Some edge cases like WebSocket fragmentation and multi-range static serving are well-covered.

## 6. Summary of Findings

| Category | Status | Notes |
| :--- | :--- | :--- |
| **Security** | ⚠️ Caution | Backpressure issue in `static.ts` multipart ranges. |
| **Type Safety** | ⚠️ Acceptable | Some `any` and casts used in core logic and `locals` handling. |
| **Spec Compliance**| ✅ Full | All required features and 75+ tests implemented. |
| **Redundancy** | ⚠️ Moderate | Redundant lineage traversal and manual header parsing. |

**Final Recommendation**: Address the backpressure issue in the `staticFiles` plugin to prevent potential memory-based DoS. Consider refactoring the `Velo` class to consolidate lineage traversal logic and improve internal type definitions to reduce reliance on `any` and type assertions.
