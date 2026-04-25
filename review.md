# Velo Code Review & Security Analysis

## 1. Adversarial & Security Analysis

### High Risk Findings

#### 1.1 Header Buffer Overflow in Slowloris Mitigation (`src/server.ts`)
The `setupSocketTimeout` method implements a manual timeout for headers to mitigate Slowloris attacks. However, the `buffer` used to accumulate header data has no size limit:
```typescript
const onData = (chunk: Buffer) => {
  buffer += chunk.toString("latin1");
  if (buffer.includes("\r\n\r\n")) { ... }
};
```
**Risk:** An attacker can send a continuous stream of data without ever sending `\r\n\r\n`, causing the `buffer` string to grow until the process runs out of memory (DoS).
**Recommendation:** Implement a maximum header size limit (e.g., 16KB) and destroy the socket if exceeded.

#### 1.2 WebSocket Control Frame Payload Limit Violation (`src/websocket.ts`)
RFC 6455 states that control frames (e.g., Close, Ping, Pong) MUST NOT have a payload length greater than 125 bytes.
```typescript
close(code = 1000, reason = "") {
  // ...
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2);
  this.sendFrame(0x08, payload);
}
```
**Risk:** If `reason` is long, Velo sends an invalid WebSocket frame. Strict clients will reject this frame or close the connection with a protocol error.
**Recommendation:** Truncate the `reason` to ensure the total payload length is $\le 125$ bytes.

#### 1.3 Incorrect Client IP Selection with `trustProxy` (`src/request.ts`)
When `trustProxy` is set to `true`, the `ip` getter returns the *last* IP in the `X-Forwarded-For` header:
```typescript
const ips = forwarded.split(",").map(ip => ip.trim());
return ips[ips.length - 1];
```
**Risk:** In a standard proxy setup (`client, proxy1, proxy2`), the last IP is the one that directly connected to the server (`proxy2`), not the original client.
**Recommendation:** If `trustProxy` is `true`, it should typically return `ips[0]` (the leftmost IP), or require a specific hop count for security.

### Medium Risk Findings

#### 1.4 Potential Path Traversal via Negative Range Start (`src/static.ts`)
The Range request parser uses `parseInt(startStr, 10)` which can return negative numbers.
```typescript
start = parseInt(startStr, 10);
if (start < stats.size && start <= end) {
  ranges.push({ start, end: Math.min(end, stats.size - 1) });
}
```
**Risk:** While `createReadStream` might handle negative starts gracefully, it's non-standard and could lead to unexpected behavior in file access logic.
**Recommendation:** Ensure `start` and `end` are non-negative.

#### 1.5 Cookie Attribute Injection (`src/response.ts`)
The `cookie()` method does not validate or escape `options.path` or `options.domain`.
```typescript
if (options.path) str += `; Path=${options.path}`;
```
**Risk:** If a developer passes unsanitized user input to these options, an attacker could inject additional cookie attributes (e.g., `; HttpOnly`, `; Secure`).
**Recommendation:** Sanitize or validate cookie attribute strings.

---

## 2. Type System Review

### "Workarounds" & `any` Usage
The codebase generally adheres to a strict type system, but several "escape hatches" were identified:

1.  **`src/static.ts:169`**: `chunk: any` in multi-range write. Should be `string | Buffer`.
2.  **`src/validation.ts:170, 232-234`**: `BaseSchema<any>` used for generic constraints. This is acceptable for generic schema handling but could be tightened with `unknown`.
3.  **`src/server.ts:32`**: `Context<any>` in `wsHandlers` WeakMap.
4.  **`tests/security.test.ts:67`**: `@ts-ignore` used to access internal connections for verification.
5.  **Test files**: Extensive use of `any` for `received` variables and mock objects. While common in tests, using `unknown` or proper interfaces would be more idiomatic.

### Strict Type Adherence
- `tsconfig.json` has `strict: true` enabled.
- The use of `Object.assign(Object.create(Object.getPrototypeOf(this)), this)` in `src/validation.ts` is a clever but non-standard way to clone classes while preserving the prototype, which might confuse some type-checking scenarios.

---

## 3. Redundancy & Code Quality

### Redundant Code
1.  **Lineage Traversal**: `src/server.ts` contains multiple implementations of parent-searching logic (`walkLineage`, `getRoot`, `errorHandler`, `notFoundHandler`). These could be consolidated into a single utility.
2.  **Radix Tree Search**: The `Router.match` method uses a recursive `search` function that recreates parameter objects frequently (`{ ...params }`). This could be optimized for performance.

### Efficiency
- `src/static.ts` uses `this.buffer.slice()` inside a loop. For large packets, this results in $O(N^2)$ data copying. A more efficient buffer consumption strategy (e.g., tracking an offset) is recommended.

---

## 4. Test Coverage Analysis

### Coverage vs. Spec
- **Static Routes & Params**: Fully covered in `router.test.ts`.
- **Middleware Pipeline**: Comprehensive coverage in `middleware.test.ts`, including execution order and error propagation.
- **WebSocket RFC 6455**: Well-tested in `websocket.test.ts`, including fragmented messages, masking, and handshake.
- **Static Files**: Path traversal, dotfiles, and Range requests are verified in `static.test.ts`.
- **Validation**: Dot-notation error paths and all validator types are tested.

### Missing Test Scenarios
1.  **Concurrent Request Stress**: No tests for high concurrency or race conditions during graceful shutdown.
2.  **Large Multi-Range Requests**: While multi-range is tested, very large numbers of ranges (near the limit of 10) are not.
3.  **Invalid Cookie Header**: The request cookie parser handles malformed URIs but not other invalid formats.
