# Findings: Velo Codebase Review & Security Analysis

This document summarizes the findings from a full adversarial review and security analysis of the Velo codebase against the provided specifications.

## 1. Security Analysis

### 1.1. Denial of Service (DoS)
- **Status:** **Secure**
- **Findings:**
    - `bodyLimit` is correctly implemented in `src/request.ts` to limit the size of incoming request bodies (default 1MB).
    - `VeloWebSocketImpl` in `src/websocket.ts` implements `maxBufferSize` (default 1MB) to protect against memory exhaustion from large WebSocket messages or fragmentation buffers.
    - Static file serving uses `node:fs.createReadStream`, ensuring memory-efficient transfers for large files.

### 1.2. Path Traversal
- **Status:** **Secure**
- **Findings:**
    - `src/static.ts` implements robust path traversal protection using multiple layers:
        - Decoding URI components before validation.
        - Checking for `..` in the decoded path.
        - Normalizing paths and verifying they remain within the `root` directory.
    - Dotfile protection is implemented with `deny`, `ignore`, and `allow` modes as requested.

### 1.3. WebSocket RFC 6455 Compliance
- **Status:** **Minor Issue (Bug Found)**
- **Findings:**
    - **Critical Bug:** In `src/websocket.ts`, the `head` buffer passed to `handleUpgrade` is ignored. RFC 6455 requires the server to process any data already read by the HTTP server after the upgrade request. If a client sends data immediately after the handshake, it will be lost.
    - Handshake logic correctly computes `Sec-WebSocket-Accept` using SHA-1 and the standard GUID.
    - Frame masking is correctly enforced for client-to-server messages.
    - Frame fragmentation and control frames (Ping/Pong/Close) are handled according to the spec.
    - Invalid UTF-8 in text frames is correctly detected and handled (closes with code 1007).

### 1.4. Prototype Pollution
- **Status:** **Secure**
- **Findings:**
    - Schema validation in `src/validation.ts` uses an allow-list approach (only processing keys defined in the schema), which prevents prototype pollution during validation.
    - Router uses `Map` for handlers, avoiding issues with object prototype properties.

## 2. Code Review & Type System

### 2.1. Type System Workarounds
- **Status:** **Issues Found**
- **Findings:**
    - **Unsound Initialization:** In `src/request.ts`, `this.locals` is initialized as `{} as L`. If `L` is a specific interface with required fields, this is type-unsound and could lead to runtime errors when accessing expected properties.
    - **Mocking Workaround:** In `src/websocket.ts`, a `Response` object is created with `null as unknown as ServerResponse`. This is a dangerous workaround. If a handler or middleware tries to access `ctx.res.raw`, it will result in a null pointer dereference.
    - **Excessive Use of `any`:** `Velo<L = any>` and several other locations use `any` as a default. While this provides flexibility, it weakens the "strict type system" goal if not properly constrained.
    - **Internal Casts:** `server.ts` uses several `as any` and `as Middleware` casts to bypass type checks for internal logic (e.g., `requestTimeout` check and middleware wrapping).

### 2.2. Redundancy and Architectural Inconsistency
- **Status:** **Minor Issues**
- **Findings:**
    - **Context Inconsistency:** `server.ts` creates a `Context` with a mock `ServerResponse` for WebSocket upgrades, but `websocket.ts` ignores it and creates its own `Context` with a `null` response. This is redundant and confusing.
    - **Redundant Middleware Wrapping:** `wrapHandler` in `src/server.ts` effectively just casts functions. While it serves as a normalization step, it adds overhead to every route registration.
    - **Multiple Context Creation:** The WebSocket upgrade path creates multiple `VeloRequest` and `VeloResponse` objects for the same underlying request/socket.

## 3. Test Case Review

### 3.1. Coverage
- **Status:** **Excellent**
- **Findings:**
    - All 75 requirements from `spec.md` are covered by the test suite.
    - Tests include adversarial cases like path traversal with encoded characters, large bodies, and invalid WebSocket frames.
    - Graceful shutdown is empirically verified.

### 3.2. Missing Tests
- **Findings:**
    - No tests specifically check for the `head` buffer processing during WebSocket upgrades (which would have caught the bug mentioned in 1.3).
    - No tests verify behavior when `ctx.res.raw` is accessed during a WebSocket `open` handler (which would have caught the workaround mentioned in 2.1).

## 4. Recommendations

1.  **Fix WebSocket `head` processing:** Update `src/websocket.ts` to process the `head` buffer immediately after the handshake.
2.  **Unify Context Management:** Ensure the same `Context` and `Response` objects are used throughout the lifecycle of a request, including WebSocket upgrades.
3.  **Strengthen Type Safety:**
    - Avoid `{} as L` by requiring a proper initializer or making `locals` optional/partial until initialized.
    - Avoid `null as unknown` for `ServerResponse`. Provide a functional mock if needed.
4.  **Clean up Redundancies:** Consolidate the middleware wrapping and context creation logic to reduce overhead and improve maintainability.
