# Progress - Velo HTTP Server

- [x] Core: Velo class (`src/server.ts`)
- [x] Routing: Radix tree (`src/router.ts`)
- [x] Request abstraction (`src/request.ts`)
- [x] Response abstraction (`src/response.ts`)
- [x] Middleware pipeline (`src/middleware.ts`)
- [x] WebSocket support (`src/websocket.ts`)
- [x] Static file serving (`src/static.ts`)
- [x] Built-in validation (`src/validation.ts`)
- [x] Plugin system (`src/plugin.ts`)
- [x] Error types (`src/errors.ts`)
- [x] Comprehensive tests (`tests/*.test.ts`)
- [x] Plugin encapsulation and scoping (`src/server.ts`)
- [x] RFC 6455 clean close handshake (`src/websocket.ts`)

## Recent Fixes
- Implemented hierarchical `Velo` instances to support proper plugin encapsulation. Middlewares registered in a scope now only apply to routes within that scope or its children.
- Updated `VeloWebSocket.close()` to wait for the client's echo Close frame before destroying the socket, adhering to RFC 6455.
- Added connection tracking to `Velo` to ensure all upgraded WebSocket connections are terminated during `app.close()`.
- Re-enabled and fixed Test 67 in `tests/plugin.test.ts`.
- Refactored `tests/websocket.test.ts` to use individual top-level tests for better reliability.
- Fixed `app.listen()` to properly handle the `error` event, preventing the promise from hanging if the port is busy.
- Made `VeloWebSocket._readyState` private to comply with the `VeloWebSocket` interface and encapsulated state changes within `VeloWebSocketImpl`.
- Fixed WebSocket `head` buffer processing to prevent data loss immediately after handshake (RFC 6455).
- Unified context management across HTTP and WebSocket upgrades.
- Removed redundant middleware wrapping overhead in route registration.
- Improved type safety for `ctx.req.locals` and removed unsound `ServerResponse` mocks.
