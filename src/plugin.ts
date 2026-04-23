import { Velo } from "./server.js";

export type Plugin<Options = any> = (
  app: Velo,
  options: Options
) => void | Promise<void>;
