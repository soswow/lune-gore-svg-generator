# Lune Gore SVG Generator (Web)

Play online: https://soswow.github.io/lune-gore-svg-generator/

This project is a browser-based TypeScript app that generates SVG globe gores (lunes).

![Web interface screenshot](docs/images/web-interface-screenshot.jpg)

## Project structure

- `index.html`: root page (redirects to built app in `js/dist/index.html`)
- `js/index.html`: Parcel entry HTML
- `js/src/main.ts`: TypeScript source
- `js/dist/`: build output folder
- `js/package.json`: dependencies and scripts

## Development

```sh
cd js
npm install
npm run start
```

This uses Parcel dev server and opens the app in your browser.

## Build

```sh
cd js
npm run build
```

Configured scripts in `js/package.json`:

```json
{
  "start": "parcel index.html --open",
  "build": "parcel build index.html --public-url https://soswow.github.io/lune-gore-svg-generator/js",
  "postbuild": "cp dist/*.js dist/*.js.map ."
}
```

`postbuild` copies Parcel bundles to `js/` so `js/dist/index.html` can resolve assets on GitHub Pages with the requested `--public-url`.

## GUI controls

The `dat.gui` panel exposes the same generator options:

- `diameter`
- `gores`
- `full-sphere`: `single`, `side-by-side`, `flower`
- `scale-x-mm`
- `scale-y-mm`
- `lat-max` (`0..90`, with lower bound fixed at `-90`)
- `samples`

`Download SVG` exports the current result.

`flower` mode behavior: when `scale-y-mm` changes, petals are shifted radially so the reference outer circle remains the same size.
