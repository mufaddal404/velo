# Velo Codebase Review & Security Analysis

## Overview
Velo is a high-quality, low-level HTTP server library for Node.js. The codebase demonstrates a strong commitment to security, performance, and type safety. It strictly adheres to the provided `@spec.md` and implements complex features like a radix-tree router and custom WebSocket handling from scratch.

---

## 1. Adversarial Review & Security Analysis

### 1.1. Path Traversal & Static Files
The implementation of `staticFiles` in `src/static.ts` is robust against path traversal attacks:
- **Redundant Protection**: It uses both a manual check for `..` after URI decoding and a `normalize` + `startsWith` check on the resolved path.
- **Dotfile Protection**: Correctlly implements `deny`, `ignore`, and `allow` modes for files starting with a dot.
- **URI Decoding**: Properly handles URL-encoded characters (e.g., `%2e%2e`) before performing safety checks.

### 1.2. WebSocket Security (RFC 6455)
The custom WebSocket implementation in `src/websocket.ts` is surprisingly complete for a "from scratch" implementation:
- **Handshake**: Validates all required headers (`Upgrade`, `Connection`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version`). Rejects invalid versions with 400.
- **Framing**:
    - **Masking**: Correctly enforces that client frames MUST be masked and unmasks them.
    - **Fragmentation**: Correctlly reassembles fragmented messages and enforces that control frames cannot be fragmented.
    - **UTF-8 Validation**: Validates text frames for valid UTF-8 and closes the connection with code `1007` on failure.
    - **Payload Limits**: Enforces `bodyLimit` on both regular frames and fragmented message buffers to prevent memory exhaustion (DoS).

### 1.3. DoS Protections
`src/server.ts` implements several low-level protections:
- **Header Timeout**: Limits the time allowed for sending headers.
- **Header Size Limit**: Enforces a 16KB limit on raw headers to prevent memory-based attacks.
- **Body Limit**: Lazily enforced during body reading in `src/request.ts`.

### 1.4. trustProxy Implementation
The `trustProxy` logic in `src/request.ts` correctly handles both boolean and numeric (hop-based) trust models, mitigating IP spoofing when properly configured.

---

## 2. Code Quality & Standards

### 2.1. Type System Integrity
The codebase exhibits excellent TypeScript usage:
- **Strict Typing**: No usage of `any` as a workaround for logic. The few occurrences of `any` (in `validation.ts`) are justified for generic schema definitions.
- **No Cast Hacks**: Avoids `as any` or `@ts-ignore` for "making things work."
- **Generics**: Effectively uses generics (especially the `L` parameter for `locals`) to maintain type safety across middleware and handlers.

### 2.2. Redundancy & Duplication
The code is generally DRY (Don't Repeat Yourself), with a few minor observations:
- **trustProxy Logic**: The logic for extracting the correct IP/Protocol based on hops is duplicated between the `ip` and `protocol` getters in `src/request.ts`.
- **Header Timeout**: The manual header parsing in `setupSocketTimeout` is slightly redundant with Node's native `server.headersTimeout`, though it provides an extra layer of visibility.

### 2.3. Logic & Patterns
- **Radix Tree**: The router in `src/router.ts` is a true compressed prefix tree, not a simple linear scan. It correctly implements matching priority (Static > Param > Wildcard).
- **Middleware Pipeline**: The `compose` function in `src/middleware.ts` implements a standard and safe recursion-based dispatch pattern with protection against multiple `next()` calls.

---

## 3. Test Case Review

### 3.1. Coverage
The tests in `tests/` are exceptionally thorough, covering:
- All 75 requirements from the spec.
- **Security Edge Cases**: Slowloris attacks, large header attacks, path traversal bypass attempts, and WebSocket framing violations.
- **Protocol Compliance**: RFC 6455 specific checks (masked frames, fragmentation, etc.).

### 3.2. Correctness
The tests use Node's built-in `node:test` and `node:assert` as requested. They correctly reproduce scenarios like graceful shutdown and backpressure in streams.

---

## 4. Findings & Recommendations

| Severity | Finding | Location |
| :--- | :--- | :--- |
| **Minor** | Duplicated `trustProxy` hop logic | `src/request.ts` |
| **Note** | `h.length > 1` heuristic for Handlers vs Middleware | `src/server.ts` |
| **Observation** | Manual header timeout might overlap with Node.js native settings | `src/server.ts` |

### Conclusion
The Velo library is a secure, well-architected, and robust implementation of a low-level HTTP server. No critical vulnerabilities or type system workarounds were discovered during this review.

-----------------------------------------------------------------
**Concurrent Request Stress**: No tests for high concurrency or race conditions during graceful shutdown.