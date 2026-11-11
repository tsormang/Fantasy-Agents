// Tiny Swords UI skins for the HUD, dialogs and pages. The pack ships each panel as nine pieces with gaps between
// them, so they are stitched into one image here and handed to CSS as border-image sources.
// The skin only switches on (html.ts-ui) once every piece has loaded, so without the sprites
// the plain styling stays.
import { img, whenLoaded } from "./game/art";

type Span = [from: number, to: number];
interface Skin {
  /** CSS custom property that receives the stitched image */
  prop: string;
  sheet: string;
  xs: Span[];
  ys: Span[];
  /** the painted area inside the stitched image: x, y, width, height */
  crop: [number, number, number, number];
}

const THREE: Span[] = [[0, 64], [128, 192], [256, 320]];

const SKINS: Skin[] = [
  { prop: "--ui-paper", sheet: "ui_paper", xs: THREE, ys: THREE, crop: [12, 20, 168, 153] },
  { prop: "--ui-button", sheet: "ui_button_blue", xs: THREE, ys: THREE, crop: [19, 17, 154, 158] },
  { prop: "--ui-button-red", sheet: "ui_button_red", xs: THREE, ys: THREE, crop: [19, 17, 154, 158] },
  // the pack's "pressed" blue button is a muted slate, used here for secondary buttons
  { prop: "--ui-button-quiet", sheet: "ui_button_quiet", xs: THREE, ys: THREE, crop: [14, 28, 164, 149] },
  // the plain grass tile from the middle of the terrain nine-patch, as a page background
  { prop: "--ui-grass", sheet: "tiles", xs: [[64, 128]], ys: [[64, 128]], crop: [0, 0, 64, 64] },
  // first row of the big ribbons: the blue one
  { prop: "--ui-ribbon", sheet: "ui_ribbons", xs: [[0, 128], [192, 256], [320, 448]], ys: [[0, 128]], crop: [30, 20, 259, 103] },
];

function stitch(s: Skin): Promise<string> {
  const src = img(s.sheet);
  const [cx, cy, cw, ch] = s.crop;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d")!;
  let dy = -cy;
  for (const [y0, y1] of s.ys) {
    let dx = -cx;
    for (const [x0, x1] of s.xs) {
      g.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx, dy, x1 - x0, y1 - y0);
      dx += x1 - x0;
    }
    dy += y1 - y0;
  }
  return new Promise((done, fail) => c.toBlob((b) => (b ? done(URL.createObjectURL(b)) : fail(new Error("no blob"))), "image/png"));
}

let started = false;

export function loadSkins(): void {
  if (started) return;
  started = true;
  void Promise.all(SKINS.map((s) => whenLoaded(s.sheet).then(() => stitch(s))))
    .then((urls) => {
      const root = document.documentElement;
      SKINS.forEach((s, i) => root.style.setProperty(s.prop, `url("${urls[i]}")`));
      root.classList.add("ts-ui");
    })
    .catch(() => {});
}
