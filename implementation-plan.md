# Velo Implementation Plan: Fixes & Refinements

This plan outlines the steps required to resolve the security vulnerabilities, type system weaknesses, and code redundancies identified during the Velo codebase review.

**Mandatory Workflow**: After completing EACH task, the following must be executed:
1. `npx tsc --noEmit` (Must have zero errors)
2. `node --test tests/` (All tests must pass)

---

## Phase 1: Critical Security Fixes (High Priority)

### 1.1 Fix Backpressure in `src/static.ts`
The current implementation of multipart range requests does not respect backpressure when writing to the `PassThrough` stream, which could lead to unbounded memory usage.

- **Action**: Refactor the async loop in the multipart handler.
- **Implementation**:
  - Replace `out.write()` calls with a pattern that waits for the `'drain'` event when `write()` returns `false`.
  - Ensure the `PassThrough` stream itself handles backpressure from the `ServerResponse`.
- **Validation**: Run type checks and the full test suite. Add a specific test case for slow consumers if possible.

---

## Phase 2: Type System Refinement (Medium Priority)

### 2.1 Refactor `src/validation.ts` Rules
Remove the use of `any` in the internal `_rules` array to ensure type safety within the builder pattern.

- **Action**: Update `BaseSchema` to use `T` for rule validation.
- **Implementation**: Change `_rules` signature to `((val: T, path: string) => ValidationError | null)[]`.
- **Validation**: Run type checks and the full test suite.

### 2.2 Improve `Velo` Internal Typing
Reduce reliance on type assertions (`as`) and `any` in the core server logic.

- **Action**: Refactor `addRoute` and `Middleware` handling.
- **Implementation**:
  - Create a unified type for "Handler-like" functions.
  - Refactor `wrapWebSocketHandler` to use a more robust way of passing the handler (e.g., a WeakMap).
- **Validation**: Run type checks and the full test suite.

### 2.3 Cast Reduction in `Response` and `Request`
- **Action**: Use type guards instead of assertions.
- **Implementation**:
  - In `Response.json()`, use a type guard or better overloaded signatures to avoid `as`.
  - Update `Request.headers` to use a type-safe wrapper.
- **Validation**: Run type checks and the full test suite.

---

## Phase 3: Architectural Refactoring & Optimization (Low Priority)

### 3.1 Consolidate Lineage Traversal in `src/server.ts`
- **Action**: Create a shared private generator or iterator for lineage access.
- **Implementation**:
  - Implement `private *walkLineage()` to yield scopes from current to root.
  - Refactor `errorHandler`, `notFoundHandler`, and `getMiddlewarePipeline` to use this iterator.
- **Validation**: Run type checks and the full test suite.

### 3.2 Cleanup Redundant Header Parsing
- **Action**: Evaluate `setupSocketTimeout` in `src/server.ts`.
- **Implementation**: 
  - Compare the manual `\r\n\r\n` check against Node's native `headersTimeout`.
  - Remove manual data listener if redundant.
- **Validation**: Run type checks and the full test suite.
