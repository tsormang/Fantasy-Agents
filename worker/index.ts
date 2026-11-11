import { Realm } from "./realm";

export { Realm };

export interface Env {
  REALM: DurableObjectNamespace<Realm>;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      // One shared village: every API call goes to the single Realm instance.
      const stub = env.REALM.get(env.REALM.idFromName("realm"));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
