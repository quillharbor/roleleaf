'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
}
run(process.execPath, ['scripts/build.cjs']);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']);
const extra = process.argv.slice(2); // e.g. --offline or -I /path/to/local-mirror.init.gradle
run(process.platform === 'win32' ? 'android/gradlew.bat' : './android/gradlew', ['-p', 'android', ':app:assembleDebug', ':app:lintDebug', '--console=plain', ...extra]);
const source = path.join(root, 'android/app/build/outputs/apk/debug');
const metadata = JSON.parse(fs.readFileSync(path.join(source, 'output-metadata.json'), 'utf8'));
const artifact = metadata.elements[0];
const target = path.join(root, 'android/release', artifact.versionName);
fs.mkdirSync(target, { recursive: true });
const filename = `RoleLeaf-TEST-ONLY-${artifact.versionName}.apk`;
const data = fs.readFileSync(path.join(source, artifact.outputFile));
fs.writeFileSync(path.join(target, filename), data);
const sha256 = createHash('sha256').update(data).digest('hex');
fs.writeFileSync(path.join(target, filename + '.sha256'), `${sha256}  ${filename}\n`);
fs.writeFileSync(path.join(target, 'release-report.json'), JSON.stringify({
  version: artifact.versionName, applicationId: metadata.applicationId,
  filename, bytes: data.length, sha256, builtAt: new Date().toISOString(),
  signing: 'Android local debug signing; internal test only',
  checks: ['Node test suite', 'assembleDebug', 'lintDebug'],
}, null, 2) + '\n');
console.log(`APK: ${path.join(target, filename)}\nSHA256: ${sha256}`);
