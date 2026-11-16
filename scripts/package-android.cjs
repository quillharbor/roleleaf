'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const demo = process.argv.includes('--demo');
if (demo && (!process.env.ROLELEAF_DEMO_KEYSTORE || !process.env.ROLELEAF_DEMO_STORE_PASSWORD ||
    !fs.existsSync(process.env.ROLELEAF_DEMO_KEYSTORE))) {
  throw Error('Demo builds require the existing fixed signing key and password via environment. Never generate a replacement key for an update.');
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
}
run(process.execPath, ['scripts/build.cjs']);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']);
// Each checkout has its own disposable development identity; never ship the key.
const debugKey = path.join(root, 'android/.signing/debug.keystore');
if (!demo && !fs.existsSync(debugKey)) {
  fs.mkdirSync(path.dirname(debugKey), { recursive: true, mode: 0o700 });
  const keytool = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
    : 'keytool';
  run(keytool, ['-genkeypair', '-keystore', debugKey, '-storepass', 'android', '-keypass', 'android',
    '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=RoleLeaf Debug,O=quillharbor']);
  fs.chmodSync(debugKey, 0o600);
}
const extra = process.argv.slice(2).filter(arg => arg !== '--demo');
const variant = demo ? 'Release' : 'Debug';
run(process.platform === 'win32' ? 'android/gradlew.bat' : './android/gradlew', ['-p', 'android', `:app:assemble${variant}`, `:app:lint${variant}`, '--console=plain', ...extra]);
const source = path.join(root, 'android/app/build/outputs/apk', variant.toLowerCase());
const metadata = JSON.parse(fs.readFileSync(path.join(source, 'output-metadata.json'), 'utf8'));
const artifact = metadata.elements[0];
const target = path.join(root, 'android/release', artifact.versionName);
fs.mkdirSync(target, { recursive: true });
const filename = `RoleLeaf-${demo ? 'DEMO' : 'TEST-ONLY'}-${artifact.versionName}.apk`;
const data = fs.readFileSync(path.join(source, artifact.outputFile));
fs.writeFileSync(path.join(target, filename), data);
const sha256 = createHash('sha256').update(data).digest('hex');
fs.writeFileSync(path.join(target, filename + '.sha256'), `${sha256}  ${filename}\n`);
fs.writeFileSync(path.join(target, 'release-report.json'), JSON.stringify({
  version: artifact.versionName, applicationId: metadata.applicationId,
  filename, bytes: data.length, sha256, builtAt: new Date().toISOString(),
  versionCode: artifact.versionCode,
  signing: demo ? 'Fixed RoleLeaf demo signing key; non-debuggable demo, not a store release' : 'Android local debug signing; internal test only',
  checks: ['Node test suite', `assemble${variant}`, `lint${variant}`],
}, null, 2) + '\n');
console.log(`APK: ${path.join(target, filename)}\nSHA256: ${sha256}`);
