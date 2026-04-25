# Velo Implementation Plan: Security & Type System Improvements

This plan outlines the steps to resolve the security vulnerabilities and code quality issues identified in the [Code Review & Security Analysis](./review.md).

## Phase 1: High-Risk Security Fixes

### 1.1 Header Buffer Size Limit
**Objective:** Prevent Memory Exhaustion (DoS) during header parsing.
- Modify `src/server.ts`: Add a constant `MAX_HEADER_SIZE = 16 * 1024`.
- In `setupSocketTimeout`, check the length of the `buffer`. If it exceeds `MAX_HEADER_SIZE`, destroy the socket.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`
  - (Optional) Add a new test case in `tests/security.test.ts` to verify the limit.

### 1.2 WebSocket Control Frame Truncation
**Objective:** Adhere to RFC 6455 regarding control frame payload length ($\le 125$ bytes).
- Modify `src/websocket.ts`: In the `close()` method, truncate the `reason` string to ensure `2 + Buffer.byteLength(reason) <= 125`.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

### 1.3 Correct Client IP Selection
**Objective:** Correctly identify the original client IP when `trustProxy` is enabled.
- Modify `src/request.ts`: Change the logic for `trustProxy: true` to return `ips[0]` instead of `ips[ips.length - 1]`.
- Update `tests/request.test.ts` (Test 24) to assert that the first IP in the list is returned.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

## Phase 2: Medium-Risk Security Fixes

### 2.1 Range Header Validation
**Objective:** Prevent potential path traversal or logic errors with negative range values.
- Modify `src/static.ts`: In the range parsing logic, ensure `start` and `end` are parsed as integers and are $\ge 0$.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

### 2.2 Cookie Attribute Sanitization
**Objective:** Prevent attribute injection in `Set-Cookie` headers.
- Modify `src/response.ts`: Sanitize `options.path` and `options.domain` by removing or escaping characters like `;`, `=`, and newlines.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

## Phase 3: Refactoring & Quality

### 3.1 Consolidate Lineage Traversal
**Objective:** Remove redundant parent-traversal logic in `Velo` class.
- Modify `src/server.ts`:
  - Keep `walkLineage` as the primary generator.
  - Refactor `getRoot`, `errorHandler`, `notFoundHandler`, and `getMiddlewarePipeline` to use `walkLineage`.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

### 3.2 Optimize WebSocket Buffer Consumption
**Objective:** Improve performance from $O(N^2)$ to $O(N)$ for large messages.
- Modify `src/websocket.ts`: Use an offset pointer instead of `buffer.slice()` for consumption within the `handleData` loop. Only perform a single `slice` or `Buffer.concat` when necessary to compact the buffer.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`

## Phase 4: Type System Hardening

### 4.1 Remove `any` and `@ts-ignore`
**Objective:** Improve type safety and adhere to project standards.
- Replace `any` in `src/static.ts`, `src/validation.ts`, and `src/server.ts` with more specific types (e.g., `string | Buffer`, `unknown`).
- Attempt to remove the `@ts-ignore` in `tests/security.test.ts` by using proper type casting or exposing required internals safely.
- **Verification:**
  - `npm run typecheck`
  - `npm run test`
