import type { VeloRequest } from "./request.js";
import type { VeloResponse } from "./response.js";

export interface Context {
  req: VeloRequest;
  res: VeloResponse;
}

export type NextFunction = () => Promise<void>;

export type Middleware = (
  ctx: Context,
  next: NextFunction
) => void | Promise<void>;

export type Handler = (ctx: Context) => void | Promise<void>;

export type ErrorHandler = (
  error: Error,
  ctx: Context
) => void | Promise<void>;

export async function compose(
  middlewares: Middleware[],
  ctx: Context
): Promise<void> {
  let index = -1;

  async function dispatch(i: number): Promise<void> {
    if (i <= index) throw new Error("next() called multiple times");
    index = i;
    const fn = middlewares[i];
    if (!fn) return;
    await fn(ctx, dispatch.bind(null, i + 1));
  }

  await dispatch(0);
}
