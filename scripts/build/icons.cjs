/**
 * Generates every app icon from ONE source: assets/brand/icon.svg. Run after changing it:
 *
 *   pnpm icons        (= electron scripts/build/icons.cjs)
 *
 * Rasterised by Electron's Chromium (already a dev dependency — no image library): the SVG is
 * drawn onto a canvas at each target size (vector → crisp small sizes, not a downscaled bitmap).
 * The outputs are committed; nothing here runs in CI or at build time.
 *
 *   apps/desktop/build/icon.png        1024×1024 (electron-builder derives the macOS .icns from it)
 *   apps/desktop/build/icon.ico        16/24/32/48/64/128/256 (Windows exe + installer)
 *   apps/web/public/favicon.svg        the SVG itself (also the 24 px logo in the app header)
 *   apps/web/public/favicon.ico        16/32/48
 *   apps/web/public/apple-touch-icon.png  180×180
 *
 * ICO entries are PNG-compressed (supported since Windows Vista and by every browser).
 */
const { copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'assets/brand/icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 180, 256, 1024];

/** An .ico file whose entries are PNG images. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at); // 0 = 256
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

async function render() {
  const svg = readFileSync(source, 'utf8');
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  await window.loadURL('data:text/html,<!doctype html><title>icons</title>');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const pngs = await window.webContents.executeJavaScript(`
    (async () => {
      const result = {};
      for (const size of ${JSON.stringify(SIZES)}) {
        const image = new Image(size, size);
        image.src = ${JSON.stringify(dataUrl)};
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, size, size);
        result[size] = canvas.toDataURL('image/png').split(',')[1];
      }
      return result;
    })()
  `);
  window.destroy();
  const png = (size) => Buffer.from(pngs[size], 'base64');

  const out = (relative, data) => {
    writeFileSync(path.join(root, relative), data);
    console.log(`icons: ${relative} (${data.length} bytes)`);
  };
  out('apps/desktop/build/icon.png', png(1024));
  out(
    'apps/desktop/build/icon.ico',
    ico(
      [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })),
    ),
  );
  copyFileSync(source, path.join(root, 'apps/web/public/favicon.svg'));
  console.log('icons: apps/web/public/favicon.svg (copied)');
  out(
    'apps/web/public/favicon.ico',
    ico([16, 32, 48].map((size) => ({ size, png: png(size) }))),
  );
  out('apps/web/public/apple-touch-icon.png', png(180));
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(render)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
