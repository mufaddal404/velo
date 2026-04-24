# Security and Code Review Findings: Velo

## 1. Security Analysis

### 1.1 Path Traversal Protection (`src/static.ts`)
The static file serving implementation uses a multi-layered approach to prevent path traversal:
- Explicitly checks for `..` in the decoded URI.
- Uses `path.normalize()` and `path.join()`.
- Validates that the resulting `fullPath` starts with the `root` directory using `startsWith(root + sep)`.
- Handles URI decoding properly before validation.
**Result:** PASSED. Very robust.

### 1.2 Denial of Service (DoS) Prevention
- **Body Limits:** Both standard HTTP requests (`src/request.ts`) and WebSockets (`src/websocket.ts`) enforce a `bodyLimit` (default 1MB). Large payloads trigger a `PayloadTooLargeError` or a WebSocket overflow error.
- **WebSocket Buffer:** The `handleData` loop in `src/websocket.ts` limits the internal buffer size to prevent memory exhaustion from slow or malformed frames.
**Result:** PASSED.

### 1.3 WebSocket Security (`src/websocket.ts`)
- **Masking:** Correctly enforces that all client frames must be masked (RFC 6455).
- **Handshake:** Validates `Upgrade`, `Connection`, and `Sec-WebSocket-Key` headers. Computes `Sec-WebSocket-Accept` correctly using SHA-1.
- **RSV Bits:** Correctly rejects frames with non-zero RSV bits.
- **Fragmentation:** Handles fragmented messages and rejects fragmented control frames as per RFC.
- **UTF-8 Validation:** Validates UTF-8 for text frames and closes with status 1007 if invalid.
**Result:** PASSED.

### 1.4 Input Validation (`src/validation.ts`)
- Implements a comprehensive schema validator from scratch.
- Handles nested objects and arrays with correct error path reporting (dot notation).
- Middleware integration correctly produces `422 Unprocessable Entity` responses.
**Result:** PASSED.

---

## 2. Code Quality & Type System

### 2.1 Type System Integrity
The codebase maintains a strict type system for the most part, but contains a few "workarounds":
- **`Request.locals`**: Initialized as `{} as any`. While this allows for an empty initial state, it bypasses strict typing until populated.
- **`Velo.listen`**: Uses `(root.server as any).requestTimeout` to support a property that might be missing in some Node.js typing versions.
- **`Velo.register`**: Uses `as any` when passing the scope to the plugin to avoid complex generic constraints.
**Result:** PASSED with minor observations. These are common patterns in low-level Node.js libraries.

### 2.2 Redundancy & Logic Duplication
- **Lineage Calculation**: The logic to calculate the `Velo` instance lineage and collect middleware is duplicated in `Velo._dispatch` and `Velo.handleUpgrade` within `src/server.ts`. This could be refactored into a protected helper method.
**Result:** MINOR FINDING.

### 2.3 Router Implementation (`src/router.ts`)
- Successfully implements a compressed prefix tree (radix tree).
- Correctly implements matching priority: Static > Param > Wildcard.
- Handles route conflicts (e.g., mismatching parameter names for the same prefix).
**Result:** PASSED.

---

## 3. Test Coverage Review

### 3.1 Coverage Statistics
- Total Tests: **88** (Requirement: 75)
- All 75 specific requirements from `spec.md` are covered and verified.

### 3.2 Correctness
- Tests for `static` include edge cases like range suffixes (`bytes=-3`) and invalid ranges.
- WebSocket tests include malformed frame injections (fragmented control frames, invalid UTF-8).
- Router tests verify the radix tree behavior (static beating param).
- Graceful shutdown is verified with an in-flight request test.
**Result:** PASSED.

---

## 4. Final Verdict
The **Velo** codebase is exceptionally well-implemented for a low-level library. It adheres strictly to the specification, implements security-sensitive features (WebSockets, Static Files) with high care for RFC compliance and adversarial robustness, and maintains a clean, TypeScript-first API.

**Recommendations:**
- Refactor the middleware lineage collection in `server.ts` to reduce duplication.
- Consider removing the `as any` in `Request.locals` by using a more sophisticated type for the initial state if possible, though the current implementation is standard practice.
