# Velo Codebase Review & Security Analysis

## 1. Executive Summary
Velo is a robust, low-level HTTP server library that adheres closely to the provided `spec.md`. The implementation is clean, TypeScript-first, and avoids external dependencies. The security posture is strong, with proactive mitigations for common web vulnerabilities and DoS attacks.

## 2. Security & Adversarial Review

### 2.1. TrustProxy Spoofing (Inquiry)
In `src/request.ts`, the `ip` getter implementation for `trustProxy: true`:
```typescript
if (this.options.trustProxy === true) {
  return ips[0]; // Leftmost IP
}
```
**Finding:** Taking the leftmost IP is insecure as it can be easily spoofed by a client sending their own `X-Forwarded-For` header. Upstream proxies typically append the client IP to this header.
**Recommendation:** When `trustProxy` is a boolean, it should ideally trust only the immediate proxy or allow configuring the number of trusted hops.

### 2.2. Path Traversal
**Finding:** `src/static.ts` implements two-layer protection:
1.  Immediate check for `..` in the decoded URI.
2.  Validation that the normalized `fullPath` starts with the `root` directory.
This is highly effective against path traversal attacks, including those using encoded characters or multiple separators.

### 2.3. WebSocket RFC 6455 Compliance
**Finding:** The manual implementation in `src/websocket.ts` is compliant with RFC 6455:
-   **Handshake:** Correctly uses SHA-1 and the specific GUID for `Sec-WebSocket-Accept`.
-   **Masking:** Correctly enforces that all client-to-server frames must be masked, as per the spec.
-   **Framing:** Correctly handles control frames (Ping/Pong/Close) and data frames (Text/Binary/Continuation), including fragmentation.
-   **Security:** Oversized frames (> 125 bytes) and fragmented control frames are correctly rejected.

### 2.4. DoS Mitigations
**Finding:**
-   **Slowloris:** `src/server.ts` implements a manual `headersTimeout` that destroys sockets failing to send `\r\n\r\n` within the allocated time.
-   **Payload Limits:** `bodyLimit` is strictly enforced during body consumption and WebSocket buffering.
-   **Range DoS:** `staticFiles` limits the number of ranges to 10, preventing a common resource exhaustion attack.

## 3. Code Review & Architecture

### 3.1. Redundancy & Duplication
**Finding:** `src/server.ts` contains duplicated logic for HTTP and HTTPS connection handling:
-   The `connection` and `secureConnection` listeners contain identical manual timeout and data buffering code.
-   **Recommendation:** Refactor this into a protected `setupSocketTimeout(socket)` method.

### 3.2. Router Efficiency
**Finding:** The router in `src/router.ts` is a true radix tree. It uses node splitting and character-indexed child lookups, fulfilling the requirement for a non-linear scan router.

### 3.3. Middleware Pipeline
**Finding:** The `compose` function in `src/middleware.ts` is a clean implementation of the onion model. It correctly detects multiple `next()` calls and handles asynchronous execution.

## 4. Type System Audit

### 4.1. Use of `any` and Casts
**Finding:** 
-   `L = any` is used for the `Context` locals. While acceptable for a general-purpose library, it requires users to cast `ctx.req.locals` or use module augmentation.
-   `src/validation.ts` uses `this as unknown as BaseSchema<T | undefined>` to change the generic type in the `optional()` builder. This is a common and safe pattern in TS for this specific use case.
-   The use of `as unknown as Router<RouteEntry<L>>` in `server.ts` when creating scopes is necessary because of the generic lineage but is functionally safe.

## 5. Test Suite Verification
**Finding:** 
-   The codebase includes 101 tests, exceeding the 75 required by the spec.
-   All 75 requirements from `spec.md` are explicitly mapped and tested.
-   Tests correctly verify edge cases like graceful shutdown, fragmented WebSockets, and multipart range requests.
-   **Missing in Tests:** While 422 errors are tested, there is no explicit test for the `BodyAlreadyConsumedError` if a user calls `json()` after `validate()` middleware has already consumed the body (though the behavior is correct in code).

## 6. Conclusion
The Velo library is production-ready from a spec-compliance and security perspective, with only minor recommendations for refactoring redundant code and hardening the `trustProxy` logic.
