// Image loading and sprite-strip drawing for the Tiny Swords art (web/src/assets/ts).
// The world is measured in units; one unit is U art pixels, so a 64px terrain tile is 16 units.

export const U = 4;

const images = new Map<string, HTMLImageElement>();
const whites = new Map<string, HTMLCanvasElement>();

/** Images load lazily on first use; nothing is drawn for one until it has arrived. */
export function img(name: string): HTMLImageElement {
  let i = images.get(name);
  if (!i) {
    i = new Image();
    i.src = new URL(`../assets/ts/${name}.png`, import.meta.url).href;
    images.set(name, i);
  }
  return i;
}

export const loaded = (i: HTMLImageElement): boolean => i.complete && i.naturalWidth > 0;

export function whenLoaded(name: string): Promise<void> {
  const i = img(name);
  if (loaded(i)) return Promise.resolve();
  return new Promise((done) => i.addEventListener("load", () => done(), { once: true }));
}

/** A horizontal strip of equal frames. (ax, ay) is the point in a frame that sits on the ground. */
export interface Strip {
  name: string;
  fw: number;
  ax: number;
  ay: number;
}

export const strip = (name: string, fw: number, ax = fw / 2, ay = fw / 2): Strip => ({ name, fw, ax, ay });

export function frameCount(s: Strip): number {
  const i = img(s.name);
  return loaded(i) ? Math.max(1, Math.round(i.naturalWidth / s.fw)) : 1;
}

/** A solid white copy of a whole sheet, used for hit flashes. */
function white(name: string, i: HTMLImageElement): HTMLCanvasElement {
  let c = whites.get(name);
  if (!c) {
    c = document.createElement("canvas");
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(i, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    whites.set(name, c);
  }
  return c;
}

export interface DrawOpts {
  flip?: boolean;
  scale?: number;
  flash?: boolean;
  /** radians, clockwise */
  rot?: number;
}

/** Draw one frame with its anchor at (x, y) in world units. */
export function drawStrip(g: CanvasRenderingContext2D, s: Strip, frame: number, x: number, y: number, o: DrawOpts = {}): void {
  const i = img(s.name);
  if (!loaded(i)) return;
  const n = Math.max(1, Math.round(i.naturalWidth / s.fw));
  const f = ((Math.floor(frame) % n) + n) % n;
  const k = (o.scale ?? 1) / U;
  const fh = i.naturalHeight;
  const src = o.flash ? white(s.name, i) : i;
  if (o.flip || o.rot) {
    g.save();
    g.translate(x, y);
    if (o.rot) g.rotate(o.rot);
    if (o.flip) g.scale(-1, 1);
    g.drawImage(src, f * s.fw, 0, s.fw, fh, -s.ax * k, -s.ay * k, s.fw * k, fh * k);
    g.restore();
  } else {
    g.drawImage(src, f * s.fw, 0, s.fw, fh, x - s.ax * k, y - s.ay * k, s.fw * k, fh * k);
  }
}
