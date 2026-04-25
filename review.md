# Velo Code Review & Security Analysis

## 1. Adversarial Review & Security Analysis

### Path Traversal (src/static.ts)
- **Finding**: The path traversal protection is implemented using a multi-layered approach:
    1. Explicit check for `..` in the decoded URI.
    2. Use of `path.normalize()`.
    3. Verification that the resulting `fullPath` starts with the `root` directory.
- **Security Rating**: **Safe**. The implementation correctly handles common traversal vectors, including encoded characters.
- **Note**: The use of `sep` (platform-specific separator) in `fullPath.startsWith(root + sep)` ensures that a directory named `/var/www-secret` cannot be accessed if the root is `/var/www`.

### WebSocket Implementation (src/websocket.ts)
- **Finding**: Handshake and framing follow RFC 6455 strictly.
- **Security Features**:
    - **Buffer Overflow Protection**: `maxBufferSize` (1MB default) is enforced for both standard and fragmented messages.
    - **Masking**: Mandatory for client frames; server rejects unmasked frames.
    - **Control Frames**: Correctly validated (non-fragmented, size limit <= 125 bytes).
    - **Error Handling**: Invalid UTF-8 in text frames results in a 1007 closure.
- **Security Rating**: **Safe**. The "from-scratch" implementation is robust against common WS attacks.

### Denial of Service (DoS) Mitigation
- **Slowloris**: `src/server.ts` implements a custom `headersTimeout` mechanism that monitors the "data" event on raw sockets to ensure headers are completed within the timeout.
- **Payload Limit**: `bodyLimit` (1MB default) is enforced during body consumption in `src/request.ts` and in WebSocket frame processing.
- **Security Rating**: **Good**. Basic DoS protections are in place.

### IP Spoofing
- **Finding**: `trustProxy` supports both boolean and hop-count (number).
- **Security Rating**: **Acceptable**. While simple, it allows developers to configure trust levels appropriately for their environment.

## 2. Type System Review

### Type System Workarounds & "Hacks"
- **Finding**: Extensive use of `any` and `as unknown as` throughout the core logic.
    - `src/server.ts`: `RouteEntry<L = any>` and `VeloInternalContext<L = any>` use `any`, bypassing strict checks for route handlers and internal state.
    - `src/server.ts`: Lineage traversal for `errorHandler` and `router` sharing uses `as unknown as Router<RouteEntry<L>>`.
    - `src/validation.ts`: `optional()` uses `this as unknown as BaseSchema<T | undefined>`. This is a builder pattern hack that effectively lies to the compiler about the instance type.
    - `src/request.ts`: `parseQuery` result is cast to `Record<string, string | string[]>`.
- **Verdict**: While `npx tsc --noEmit` passes, the codebase relies heavily on type assertions and `any` to manage its hierarchical structure and generics. This reduces the safety benefits of the strict type system.

### Generic Locals (`L`)
- **Finding**: The `L` generic for `locals` is inconsistently applied or defaulted to `any` in many internal signatures, which cascades through the middleware pipeline.

## 3. Adherence to @spec.md

### Core Requirements
- **Radix Tree Router**: **Compliant**. `src/router.ts` implements a proper compressed prefix tree with node splitting.
- **Zero Dependencies**: **Compliant**. Only `node:*` modules are used.
- **Middleware Pipeline**: **Compliant**. Implements `next()` advancing and 500-error on unhandled skips.
- **Static Files**: **Compliant**. Supports ETags, Ranges (single and multipart), and dotfile rules.
- **Validation**: **Compliant**. Builder-style API matches the spec.
- **Plugin System**: **Compliant**. Supports scoping and `decorate()`.

### Performance & Quality
- **Linear Scan vs. Trie**: The router uses a Trie, satisfying the requirement for non-linear lookups.
- **Graceful Shutdown**: Implemented in `src/server.ts`. It waits for the HTTP server to close (draining in-flight requests) and explicitly destroys WebSockets.

## 4. Test Case Review

### Coverage & Accuracy
- **Finding**: The project contains 102 tests, exceeding the 75 required tests.
- **Verification**: 
    - All 75 specific test scenarios listed in `@spec.md` are accounted for and numbered in the test files.
    - Additional tests cover edge cases like URI decoding errors, double-slash normalization, and stream error handling.
- **Functionality**: Tests use `node:test` and `node:assert` as required. They correctly capture behavioral requirements.

## 5. Redundancy & Code Quality

### Duplicated Logic
- **Linage Traversal**: `src/server.ts` contains multiple methods that traverse the `parent` chain (`getRoot`, `getMiddlewarePipeline`, `errorHandler`, `notFoundHandler`). While functional, this logic is slightly fragmented.
- **Router Instances**: Separate `router` and `wsRouter` instances are used. This is a clean separation of concerns.

### Efficiency
- **Middleware Composition**: The `compose` function is a standard, efficient implementation of the "onion" model.
- **Body Parsing**: Bodies are read lazily, which is efficient for memory and performance.

## 6. Summary of Findings

| Category | Status | Notes |
| :--- | :--- | :--- |
| **Security** | ✅ Secure | Good protections against DoS, Traversal, and WS attacks. |
| **Type Safety** | ⚠️ Weak | Excessive use of `any` and type assertions. |
| **Spec Compliance**| ✅ Full | All features and test cases implemented as requested. |
| **Redundancy** | ✅ Low | Clean separation of components. |

**Overall Recommendation**: The codebase is functionally solid and secure, but the internal type architecture should be refactored to remove "type hacks" and `any` usage to truly leverage TypeScript's strict mode.
