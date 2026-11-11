import type { Env as WorkerEnv } from "../worker/index";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
