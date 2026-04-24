import type { VeloRequest } from "./request.js";
import type { VeloResponse } from "./response.js";

export interface Context<L = any> {
  req: VeloRequest<L>;
  res: VeloResponse;
}

export type NextFunction = () => Promise<void>;

export type Middleware<L = any> = (
  ctx: Context<L>,
  next: NextFunction
) => void | Promise<void>;

export type Handler<L = any> = (ctx: Context<L>) => void | Promise<void>;

export type ErrorHandler<L = any> = (
  error: Error,
  ctx: Context<L>
) => void | Promise<void>;

export async function compose<L = any>(
  middlewares: Middleware<L>[],
  ctx: Context<L>
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
