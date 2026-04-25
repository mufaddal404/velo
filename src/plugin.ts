import { Velo } from "./server.js";

export type Plugin<Options = unknown> = (
  app: Velo<any>,
  options: Options
) => void | Promise<void>;
