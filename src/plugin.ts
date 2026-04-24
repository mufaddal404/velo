import { Velo } from "./server.js";

export type Plugin<Options = unknown> = (
  app: Velo,
  options: Options
) => void | Promise<void>;
