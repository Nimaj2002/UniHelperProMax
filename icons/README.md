# UniHelperProMax logo files (mascot edition)

Same file names and folders as the previous set (`../old`), so they can be dropped in as a replacement. The artwork is new:

- **Mark**: the UniHelperProMax mascot (pink-haired student with tablet, satchel and two chicks).
- **App icon**: the uniform icon (sailor collar, red scarf, satchel with chick pins).
- **Wordmark**: "UniHelper" + "ProMax" in a bold condensed sans.

The file names still say "plum" so existing references keep working. The brand colour is now pink.

## Colors and type

| Use | Color |
|---|---|
| Pink "ProMax", on light backgrounds | `#DC548B` |
| Pink "ProMax", on dark backgrounds | `#F07AAB` |
| Ink "UniHelper", on light backgrounds | `#353940` |
| Light "UniHelper", on dark backgrounds | `#E9EBF5` |
| Dark app-icon background | `#1C1F2E` |

Wordmark: Bahnschrift (weight 700, width 80), converted to shapes, so no font is needed.

## Vector files (`svg/`)

| File | Description |
|---|---|
| `mark.svg` | One-colour mascot (true vector, `currentColor`). Follows the surrounding text colour. |
| `mark-white.svg` | Same, in white, for pink, dark or photo backgrounds. |
| `mark-small.svg` | One-colour head-and-shoulders mascot (`currentColor`) for small sizes, down to about 48 px. Use the app icon below that. |
| `mark-plum.svg` | Full-colour mascot, for light backgrounds. The PNG is embedded inside the SVG. |
| `mark-plum-dark.svg` | Full-colour mascot with a white sticker outline, for dark backgrounds. The PNG is embedded inside the SVG. |
| `app-icon.svg` | Uniform app icon, light version. The PNG is embedded inside the SVG. |
| `app-icon-dark.svg` | Uniform app icon on dark navy. The PNG is embedded inside the SVG. |
| `lockup.svg` | Mascot + wordmark, for light backgrounds. The wordmark is vector; the mascot is an embedded PNG. |
| `lockup-dark.svg` | Mascot (sticker outline) + wordmark, for dark backgrounds. |

The mascot and icon are illustrations, so the full-colour SVGs hold a PNG inside the SVG wrapper. Only `mark.svg`, `mark-white.svg` and `mark-small.svg`, plus the lockup wordmark, are true vectors.

## Image files (`png/`) — all with transparent backgrounds

| File | Size | Description |
|---|---|---|
| `mark-plum-1024.png` | 1024 × 1024 | Full-colour mascot. |
| `mark-white-1024.png` | 1024 × 1024 | One-colour white mascot. |
| `mascot-512.png` | 512 × 512 | Full-colour mascot, downscaled for the web (sign-in page, website hero). |
| `app-icon-1024.png` / `-512` / `-192` | 1024 / 512 / 192 | App icon (store, PWA manifest). |
| `app-icon-dark-1024.png` | 1024 × 1024 | Dark-mode app icon. |
| `lockup-2000w.png` | 2000 px wide | Mascot + name, light backgrounds. |
| `lockup-dark-2000w.png` | 2000 px wide | Mascot + name, dark backgrounds. |

## Browser icons (`favicon/`)

`favicon.ico` (16/32/48), `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png` (180 × 180). All use the uniform app icon.

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## Rebuilding

Run `python ../build_new.py`. It reads the images in `../new` and needs `pillow numpy scipy fonttools potracer`.

The mascot source is 768 px tall, so the 1024 px mascot PNG is slightly upscaled. For sharper results, put a larger mascot render in `new/` and rebuild.
