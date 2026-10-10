const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
module.exports = async ({appOutDir, electronPlatformName}) => {
  if (electronPlatformName !== 'win32') return;
  const archive = path.join(appOutDir, 'resources', 'app.asar');
  const files = asar.listPackage(archive);
  if (files.some(f => /@julusian\/freetype2\/build\/.*\.node$/.test(f))) {
    throw new Error('Unsafe host-built freetype binary in Windows package');
  }
  const relative = 'node_modules/@julusian/freetype2/prebuilds/freetype2-win32-x64/node-napi-v7.node';
  const p = path.join(archive + '.unpacked', relative);
  const b = fs.readFileSync(p);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('ascii', 0, 2) !== 'MZ' || b.toString('ascii', pe, pe + 4) !== 'PE\0\0' || b.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error('Missing Windows x64 freetype prebuild');
  }
  console.log('Windows native package: no host-build override; x64 PE prebuild verified');
};
