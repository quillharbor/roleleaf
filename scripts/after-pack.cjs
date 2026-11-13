const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const execFileAsync = promisify(execFile);

exports.afterPack = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  if (/-temp$/.test(context.appOutDir)) return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath,
  ]);
};
