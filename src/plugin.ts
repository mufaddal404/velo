import { Velo } from "./server.js";

export type Plugin<Options = unknown, L extends Record<string, unknown> = Record<string, unknown>> = (
  app: Velo<L>,
  options: Options
) => void | Promise<void>;
