import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronPackageJson = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8'));
const electronVersion = electronPackageJson.version;
const appVersion = packageJson.version;
const productName = packageJson.build?.productName ?? 'OBS音频检测助手';
const releaseDir = join(root, 'release');
const workDir = join(releaseDir, '.win-portable-work');
const electronZipName = `electron-v${electronVersion}-win32-x64.zip`;
const electronZip = join(workDir, electronZipName);
const electronUrls = [
  `https://npmmirror.com/mirrors/electron/v${electronVersion}/${electronZipName}`,
  `https://github.com/electron/electron/releases/download/v${electronVersion}/${electronZipName}`
];
const unpackDir = join(releaseDir, `OBS-Audio-Detection-Assistant-${appVersion}-win-x64-portable`);
const appDir = join(unpackDir, 'resources', 'app');
const zipPath = join(releaseDir, `OBS-Audio-Detection-Assistant-${appVersion}-win-x64-portable.zip`);

rmSync(workDir, { recursive: true, force: true });
rmSync(unpackDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

const cachedZip = findCachedElectronZip(electronVersion);
if (cachedZip) {
  console.log(`Using cached Windows Electron runtime: ${cachedZip}`);
  copyFileSync(cachedZip, electronZip);
} else {
  for (const url of electronUrls) {
    try {
      console.log(`Downloading ${url}`);
      execFileSync('curl', ['-L', '--fail', '--retry', '2', '--connect-timeout', '20', '-o', electronZip, url], {
        stdio: 'inherit'
      });
      break;
    } catch (error) {
      rmSync(electronZip, { force: true });
      if (url === electronUrls.at(-1)) {
        throw error;
      }
    }
  }
}

console.log('Extracting Windows Electron runtime');
execFileSync('unzip', ['-q', electronZip, '-d', unpackDir], { stdio: 'inherit' });

console.log('Writing app payload');
mkdirSync(appDir, { recursive: true });
cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true });
copyFileSync(join(root, 'package-lock.json'), join(appDir, 'package-lock.json'));
writeFileSync(
  join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: appVersion,
      private: true,
      type: packageJson.type,
      main: packageJson.main,
      dependencies: packageJson.dependencies
    },
    null,
    2
  )}\n`,
  'utf8'
);

console.log('Installing production dependencies for packaged app');
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: appDir,
  stdio: 'inherit'
});
rmSync(join(appDir, 'package-lock.json'), { force: true });

const originalExe = join(unpackDir, 'electron.exe');
const renamedExe = join(unpackDir, `${productName}.exe`);
copyFileSync(originalExe, renamedExe);
rmSync(originalExe, { force: true });

console.log('Creating portable zip');
execFileSync('zip', ['-qry', zipPath, basename(unpackDir)], { cwd: releaseDir, stdio: 'inherit' });
rmSync(workDir, { recursive: true, force: true });

console.log(`Portable exe: ${renamedExe}`);
console.log(`Portable zip: ${zipPath}`);

function findCachedElectronZip(version) {
  const cacheDir = join(process.env.HOME ?? '', 'Library', 'Caches', 'electron');
  const exact = join(cacheDir, `electron-v${version}-win32-x64.zip`);
  return existsSync(exact) ? exact : null;
}
