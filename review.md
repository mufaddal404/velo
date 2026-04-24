# Velo Codebase Review & Security Analysis

## 1. Adversarial Review & Security Analysis

### Static File Serving (`src/static.ts`)
- **Path Traversal Protection**: Strong. Uses `decodeURIComponent`, `normalize`, and verifies that the resulting path still starts with the root directory (`startsWith(root + sep)`).
- **Dotfile Protection**: Solid. Correctly denies, ignores, or allows dotfiles based on configuration by checking each path segment.
- **Range Requests**: Functional for single ranges. However, it does not support multiple ranges (e.g., `Range: bytes=0-10, 20-30`), which is not explicitly required by the spec but could be a future improvement. The current parsing logic is a bit brittle for complex Range headers but safe for typical usage.
- **ETag**: Implements weak ETags based on file size and modification time. Correctly handles `If-None-Match`.

### WebSocket Implementation (`src/websocket.ts`)
- **RFC 6455 Compliance**:
    - **Handshake**: Correctly implements the `Sec-WebSocket-Accept` calculation using SHA-1 and the specified GUID. Validates `Upgrade` and `Connection` headers.
    - **Framing**: Correctly handles opcode parsing, unmasking (mandatory for client frames), and multi-byte length fields (16-bit and 64-bit).
    - **Control Frames**: Correctly rejects fragmented control frames and those with payloads larger than 125 bytes, as per RFC.
    - **Fragmentation**: Correctly reassembles fragmented messages and enforces state (rejects unexpected continuation frames or new data frames during fragmentation).
    - **Security**: 
        - Implements `maxBufferSize` to prevent memory exhaustion from large or fragmented payloads.
        - Validates UTF-8 for text frames using `TextDecoder` with `fatal: true`.
        - Closes connections with appropriate status codes (e.g., 1007 for invalid UTF-8).

### Request & Body Handling (`src/request.ts`)
- **Lazy Reading**: Request bodies are read lazily only when requested (`json()`, `text()`, `buffer()`).
- **Body Limits**: Correctly enforces `bodyLimit` during reading, throwing `PayloadTooLargeError`.
- **Consumption State**: Correctly prevents multiple body consumption with `BodyAlreadyConsumedError`.
- **Proxy Trust**: Correctly implements `trustProxy` for `ip` and `protocol` by respecting `X-Forwarded-For` and `X-Forwarded-Proto`.

### Routing (`src/router.ts`)
- **Radix Tree**: Correctly implemented trie-based router.
- **Priority**: Implements the required priority: Static > Named Parameters > Wildcards.
- **Missing Normalization**: The router does not normalize paths (e.g., collapsing double slashes or handling trailing slashes consistently). While not a vulnerability, it can lead to inconsistent behavior if the developer doesn't handle it.

## 2. Code Review & Type System

### Type System Integrity
- **Strict Typing**: The codebase adheres to strict TypeScript standards. Generics are used effectively for `locals` (`Velo<L>`).
- **Workarounds**: No egregious use of `any` or improper type casts were found. The use of `as unknown as BaseSchema<T | undefined>` in `validation.ts` is a common pattern for fluent APIs and is handled safely.
- **Validation types**: The `ObjectOutput` type in `validation.ts` is particularly well-implemented, correctly handling optional fields in the resulting typed data.

### Redundancy & Logic
- **Minimalist**: The codebase is very lean with no significant redundant or dead code.
- **Plugin System**: The scoping mechanism for plugins is well-designed, ensuring that middleware and routes registered within a scope do not leak to the parent.

## 3. Test Case Review

### Coverage
- **Total Tests**: 89 tests pass, exceeding the minimum 75 required by the spec.
- **Edge Cases**:
    - Tests cover URI decoding and path traversal with encoded characters.
    - WebSocket tests cover fragmented frames, invalid UTF-8, and buffer overflows.
    - Validation tests cover nested objects, all built-in types, and middleware integration.
- **Graceful Shutdown**: Test 75 verifies that the server waits for in-flight requests before closing.

### Improvements/Suggestions
- **Range Header**: Could add a test for multiple ranges to document behavior (currently only the first range is parsed).
- **Router Normalization**: Could add tests for double slashes `//` to see how the router handles them.

## Final Verdict
The codebase is exceptionally clean, secure, and adheres strictly to the provided specification. The from-scratch implementations of the Radix Tree and WebSocket framing are robust and follow their respective RFCs/standards closely. No significant security vulnerabilities were identified.
