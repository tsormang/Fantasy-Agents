// Prefix routes preserve spectator/invite codes and query options when switching.
export const lite = /^\/lite(?:\/|$)/.test(location.pathname);
export const path = location.pathname.replace(/^\/lite(?=\/|$)/, "") || "/";

export function modePath(target: string): string {
  return lite ? `/lite${target === "/" ? "" : target}` : target;
}

export function alternateModePath(): string {
  return (lite ? path : `/lite${path === "/" ? "" : path}`) + location.search + location.hash;
}
