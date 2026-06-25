const { app, BrowserWindow } = require('electron');
const { execFile } = require('node:child_process');
const { mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { basename, join, resolve } = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = resolve(__dirname, '..');
const buildDir = join(root, 'build');
const iconSvgPath = join(buildDir, 'icon.svg');
const iconsetDir = join(buildDir, 'icon.iconset');

app.on('window-all-closed', () => {
  // Keep the icon renderer alive while it opens and closes temporary windows.
});

function htmlFor(svg, width, height, background = 'transparent') {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body {
            width: ${width}px;
            height: ${height}px;
            margin: 0;
            overflow: hidden;
            background: ${background};
          }
          svg {
            display: block;
            width: ${width}px;
            height: ${height}px;
          }
        </style>
      </head>
      <body>${svg}</body>
    </html>`;
}

async function renderSvg(svg, outPath, width, height, options = {}) {
  const htmlPath = join(buildDir, `.render-${process.pid}-${Date.now()}-${basename(outPath)}.html`);
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: options.background === undefined || options.background === 'transparent',
    backgroundColor: '#00000000',
    useContentSize: true,
    width,
    height,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true
    }
  });

  try {
    await writeFile(htmlPath, htmlFor(svg, width, height, options.background));
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));

    const captured = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    const size = captured.getSize();
    const image = size.width === width && size.height === height ? captured : captured.resize({ width, height, quality: 'best' });
    await writeFile(outPath, image.toPNG());
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
    await rm(htmlPath, { force: true });
  }
}

function iconBody() {
  return `<g fill="none" fill-rule="evenodd" transform="translate(112 78) scale(.78)">
    <path fill="#76A8F7" d="M512 118c113.4 0 205.3 91.9 205.3 205.3v225.4C717.3 662.1 625.4 754 512 754s-205.3-91.9-205.3-205.3V323.3C306.7 209.9 398.6 118 512 118Z"/>
    <path fill="#4B8EF6" fill-opacity=".78" d="M239.8 439.5c33.9 0 61.4 27.5 61.4 61.4 0 116.4 94.4 210.8 210.8 210.8s210.8-94.4 210.8-210.8c0-33.9 27.5-61.4 61.4-61.4s61.4 27.5 61.4 61.4c0 163.5-121.8 298.6-279.5 319.4v84.2h76.2c33.9 0 61.4 27.5 61.4 61.4s-27.5 61.4-61.4 61.4H381.7c-33.9 0-61.4-27.5-61.4-61.4s27.5-61.4 61.4-61.4h76.2v-84.2C300.2 799.5 178.4 664.4 178.4 500.9c0-33.9 27.5-61.4 61.4-61.4Z"/>
    <rect x="395" y="270" width="234" height="62" rx="31" fill="#fff"/>
    <rect x="395" y="432" width="234" height="62" rx="31" fill="#fff"/>
  </g>`;
}

function traySvg(fill, status = null) {
  const dot = status ? `<circle cx="24.5" cy="7.5" r="4.5" fill="${status}" />` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" fill-rule="evenodd">
      <path fill="${fill}" d="M16 2.5c4.9 0 8.9 4 8.9 8.9v7.2c0 4.9-4 8.9-8.9 8.9s-8.9-4-8.9-8.9v-7.2c0-4.9 4-8.9 8.9-8.9Z"/>
      <rect x="11.3" y="8.2" width="9.4" height="2.8" rx="1.4" fill="#fff"/>
      <rect x="11.3" y="14.1" width="9.4" height="2.8" rx="1.4" fill="#fff"/>
      ${dot}
    </g>
  </svg>`;
}

function trayTemplateSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <path fill="#000" d="M16 3c4.8 0 8.7 3.9 8.7 8.7v6.4c0 4.8-3.9 8.7-8.7 8.7s-8.7-3.9-8.7-8.7v-6.4C7.3 6.9 11.2 3 16 3Z"/>
    <path fill="#000" d="M5.4 14.3c1.7 0 3 1.3 3 3 0 4.2 3.4 7.6 7.6 7.6s7.6-3.4 7.6-7.6c0-1.7 1.3-3 3-3s3 1.3 3 3c0 6.1-4.4 11.2-10.2 12.2V32h-6.8v-2.5C6.8 28.5 2.4 23.4 2.4 17.3c0-1.7 1.3-3 3-3Z"/>
  </svg>`;
}

function installerHeaderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 57">
    <rect width="150" height="57" fill="#F6FAFF"/>
    <svg x="6" y="4" width="49" height="49" viewBox="0 0 1024 1024">${iconBody()}</svg>
    <text x="60" y="25" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="16" font-weight="700" fill="#1E3A8A">OBS 音频</text>
    <text x="61" y="42" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="10" fill="#64748B">检测助手</text>
  </svg>`;
}

function installerSidebarSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 314">
    <rect width="164" height="314" fill="#F6FAFF"/>
    <svg x="25" y="30" width="114" height="114" viewBox="0 0 1024 1024">${iconBody()}</svg>
    <text x="82" y="195" text-anchor="middle" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="24" font-weight="700" fill="#1E3A8A">OBS 音频</text>
    <text x="82" y="224" text-anchor="middle" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="15" fill="#64748B">检测助手</text>
    <rect x="48" y="258" width="68" height="8" rx="4" fill="#DCEBFF"/>
    <rect x="48" y="258" width="44" height="8" rx="4" fill="#76A8F7"/>
  </svg>`;
}

async function pngToBmp(pngPath, bmpPath) {
  await execFileAsync('/usr/bin/sips', ['-s', 'format', 'bmp', pngPath, '--out', bmpPath]);
  await rm(pngPath, { force: true });
}

async function buildIco(entries, outPath) {
  const images = [];
  for (const entry of entries) {
    images.push({
      size: entry.size,
      data: await readFile(entry.path)
    });
  }

  const headerSize = 6 + images.length * 16;
  const totalSize = headerSize + images.reduce((sum, image) => sum + image.data.length, 0);
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(images.length, offset);
  offset += 2;

  let dataOffset = headerSize;
  for (const image of images) {
    buffer.writeUInt8(image.size >= 256 ? 0 : image.size, offset++);
    buffer.writeUInt8(image.size >= 256 ? 0 : image.size, offset++);
    buffer.writeUInt8(0, offset++);
    buffer.writeUInt8(0, offset++);
    buffer.writeUInt16LE(1, offset);
    offset += 2;
    buffer.writeUInt16LE(32, offset);
    offset += 2;
    buffer.writeUInt32LE(image.data.length, offset);
    offset += 4;
    buffer.writeUInt32LE(dataOffset, offset);
    offset += 4;
    image.data.copy(buffer, dataOffset);
    dataOffset += image.data.length;
  }

  await writeFile(outPath, buffer);
}

async function main() {
  await mkdir(buildDir, { recursive: true });
  await rm(iconsetDir, { recursive: true, force: true });
  const iconSvg = await readFile(iconSvgPath, 'utf8');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const generated = [];

  for (const size of sizes) {
    const out = join(buildDir, `.icon-${size}.png`);
    await renderSvg(iconSvg, out, size, size);
    generated.push({ size, path: out });
  }

  await writeFile(join(buildDir, 'icon.png'), await readFile(join(buildDir, '.icon-1024.png')));
  await buildIco(generated.filter((entry) => [16, 24, 32, 48, 64, 128, 256].includes(entry.size)), join(buildDir, 'icon.ico'));

  await mkdir(iconsetDir, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(join(iconsetDir, `icon_${size}x${size}.png`), await readFile(join(buildDir, `.icon-${size}.png`)));
    await writeFile(join(iconsetDir, `icon_${size}x${size}@2x.png`), await readFile(join(buildDir, `.icon-${size * 2}.png`)));
  }
  await execFileAsync('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')]);
  await rm(iconsetDir, { recursive: true, force: true });

  await renderSvg(traySvg('#76A8F7', '#22C55E'), join(buildDir, 'tray-safe.png'), 32, 32);
  await renderSvg(traySvg('#76A8F7', '#F59E0B'), join(buildDir, 'tray-warning.png'), 32, 32);
  await renderSvg(traySvg('#76A8F7', '#EF4444'), join(buildDir, 'tray-danger.png'), 32, 32);
  await renderSvg(traySvg('#76A8F7', '#94A3B8'), join(buildDir, 'tray-idle.png'), 32, 32);
  await renderSvg(trayTemplateSvg(), join(buildDir, 'tray-macTemplate.png'), 32, 32);

  const headerPng = join(buildDir, '.installer-header.png');
  const sidebarPng = join(buildDir, '.installer-sidebar.png');
  await renderSvg(installerHeaderSvg(), headerPng, 150, 57, { background: '#F6FAFF' });
  await renderSvg(installerSidebarSvg(), sidebarPng, 164, 314, { background: '#F6FAFF' });
  await pngToBmp(headerPng, join(buildDir, 'installer-header.bmp'));
  await pngToBmp(sidebarPng, join(buildDir, 'installer-sidebar.bmp'));

  for (const entry of generated) {
    await rm(entry.path, { force: true });
  }

  console.log('Generated icon assets from SVG source.');
}

app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.quit();
    process.exitCode = 1;
  });
