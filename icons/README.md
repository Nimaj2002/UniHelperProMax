# UniHelperProMax logo files

The UniHelperProMax logo is the **Three Cards / Record** mark: an outlined side card, the main workspace card with three note lines cut out, and the audio card with a record dot cut out. It mirrors the app's planned layout of a side card, the main workspace and an audio card.

All paths below are relative to this `final/` folder. Every PNG has a transparent background. App icon PNGs are transparent outside their rounded corners.

## Colors and type

| Use | Color |
|---|---|
| Plum, on light backgrounds | `#7A3DB8` |
| Plum, on dark backgrounds | `#C49BFF` |
| Ink (text on light backgrounds) | `#161A2E` |
| Light text (on dark backgrounds) | `#E9EBF5` |

Wordmark: Bricolage Grotesque, weight 500 for "UniHelper" and 700 for "ProMax". The letters are converted to shapes, so the font doesn't need to be installed.

## Vector files (`svg/`)

SVG files scale to any size without losing quality. The size listed is the default size; the viewBox is the drawing grid.

| File | Location | Size | Description |
|---|---|---|---|
| `mark.svg` | `svg/mark.svg` | 100 × 100, viewBox `0 0 100 100` | The logo with no fixed color. It uses `currentColor`, so it takes the text color around it and follows light, dark and custom themes. Use this one inside the app. |
| `mark-plum.svg` | `svg/mark-plum.svg` | 100 × 100, viewBox `0 0 100 100` | The logo in plum `#7A3DB8`, for light backgrounds. |
| `mark-plum-dark.svg` | `svg/mark-plum-dark.svg` | 100 × 100, viewBox `0 0 100 100` | The logo in light plum `#C49BFF`, for dark backgrounds. |
| `mark-white.svg` | `svg/mark-white.svg` | 100 × 100, viewBox `0 0 100 100` | The logo in white, for plum or photo backgrounds. |
| `mark-small.svg` | `svg/mark-small.svg` | 100 × 100, viewBox `0 0 100 100` | Version for small sizes, 48 px and below: thicker lines, two note lines instead of three, bigger record dot. Uses `currentColor`. |
| `app-icon.svg` | `svg/app-icon.svg` | 100 × 100, viewBox `0 0 100 100` | App icon: plum `#7A3DB8` rounded square with the white logo. |
| `app-icon-dark.svg` | `svg/app-icon-dark.svg` | 100 × 100, viewBox `0 0 100 100` | Dark-mode app icon: light plum `#C49BFF` rounded square with the logo in ink `#161A2E`. |
| `lockup.svg` | `svg/lockup.svg` | 549 × 100, viewBox `0 0 549 100` | Logo with the name "UniHelperProMax", for light backgrounds: plum logo and "ProMax", ink "UniHelper". |
| `lockup-dark.svg` | `svg/lockup-dark.svg` | 549 × 100, viewBox `0 0 549 100` | Logo with the name, for dark backgrounds: light plum logo and "ProMax", light "UniHelper". |

## Image files (`png/`)

| File | Location | Size | Description |
|---|---|---|---|
| `mark-plum-1024.png` | `png/mark-plum-1024.png` | 1024 × 1024 px | The logo in plum `#7A3DB8`, transparent background. |
| `mark-white-1024.png` | `png/mark-white-1024.png` | 1024 × 1024 px | The logo in white, transparent background. For plum or dark backgrounds. |
| `app-icon-1024.png` | `png/app-icon-1024.png` | 1024 × 1024 px | App icon, full size. For app stores and presentations. |
| `app-icon-512.png` | `png/app-icon-512.png` | 512 × 512 px | App icon. For the 512 px icon in a web app manifest (PWA). |
| `app-icon-192.png` | `png/app-icon-192.png` | 192 × 192 px | App icon. For the 192 px icon in a web app manifest (PWA). |
| `app-icon-dark-1024.png` | `png/app-icon-dark-1024.png` | 1024 × 1024 px | Dark-mode app icon, full size. |
| `lockup-2000w.png` | `png/lockup-2000w.png` | 2000 × 364 px | Logo with the name, for light backgrounds. For documents, slides and README headers. |
| `lockup-dark-2000w.png` | `png/lockup-dark-2000w.png` | 2000 × 364 px | Logo with the name, for dark backgrounds. |

## Browser icons (`favicon/`)

These use the small-size version on the plum app icon background, so the details stay visible at 16 px.

| File | Location | Size | Description |
|---|---|---|---|
| `favicon.ico` | `favicon/favicon.ico` | 16 × 16, 32 × 32 and 48 × 48 px in one file | Classic browser-tab icon. Works in every browser. |
| `favicon.svg` | `favicon/favicon.svg` | 100 × 100, viewBox `0 0 100 100` | Vector browser-tab icon for modern browsers. Stays sharp on high-resolution screens. |
| `favicon-16.png` | `favicon/favicon-16.png` | 16 × 16 px | Browser-tab icon as a PNG. |
| `favicon-32.png` | `favicon/favicon-32.png` | 32 × 32 px | Browser-tab icon as a PNG, for high-resolution screens. |
| `favicon-48.png` | `favicon/favicon-48.png` | 48 × 48 px | Icon for Windows taskbar shortcuts and bookmarks. |
| `apple-touch-icon.png` | `favicon/apple-touch-icon.png` | 180 × 180 px | Home-screen icon on iPhone and iPad. Uses the regular logo, not the small-size version. |

### Adding the favicons to the web app

Copy the files in `favicon/` to the frontend's `public/` folder, then add these lines to the page `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## Rebuilding the files

All files are generated by `../build_final.py`. To change the logo, edit that script and run it with the Bricolage Grotesque variable font file:

```
python build_final.py path/to/BricolageGrotesque[opsz,wdth,wght].ttf
```

It needs the Python packages `cairosvg`, `pillow`, `fonttools` and `uharfbuzz`.
