'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Error(`${path.basename(command)} 执行失败（${result.status}）。\n${result.stderr || result.stdout || ''}`);
  }
  return result.stdout || '';
}

function parseArgs(args) {
  const result = { mode: args[0], arch: 'universal', localElectron: false };
  if (!['test', 'release', 'check'].includes(result.mode)) throw Error('用法：desktop-release.cjs test|release|check [--arch universal|arm64|x64] [--local-electron]');
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--arch' && ['universal', 'arm64', 'x64'].includes(args[i + 1])) result.arch = args[++i];
    else if (args[i] === '--local-electron') result.localElectron = true;
    else throw Error(`未知参数：${args[i]}`);
  }
  if (result.localElectron && (result.mode !== 'test' || result.arch !== process.arch)) {
    throw Error('--local-electron 仅用于与本机架构一致的测试包。');
  }
  return result;
}

function signingEnvironment(env, identities) {
  const identity = env.CSC_NAME;
  if (!identity?.startsWith('Developer ID Application: ') || !identities.includes(`"${identity}"`)) {
    throw Error('未找到指定的 Developer ID Application 签名身份及配套私钥。请在构建机安装后设置 CSC_NAME；不会生成正式包。');
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') throw Error('正式构建不能禁用签名身份发现。');
  if (!env.APPLE_KEYCHAIN_PROFILE) throw Error('请设置 APPLE_KEYCHAIN_PROFILE，指向已用 notarytool store-credentials 保存的公证凭据。');
  // Keep the documented keychain flow unambiguous; builder otherwise prioritizes API/Apple ID credentials.
  for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'CSC_LINK']) {
    if (env[key]) throw Error(`本发布入口使用已安装证书及钥匙串 profile，请先取消设置 ${key}，避免混用凭据。`);
  }
  return { ...env };
}

function keychainArgs(env) {
  return ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, ...(env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [])];
}

function notarizeDmg(dmg, env, execute = run) {
  const result = JSON.parse(execute('xcrun', ['notarytool', 'submit', dmg, ...keychainArgs(env), '--wait', '--output-format', 'json']));
  if (result.status !== 'Accepted' || !result.id) {
    throw Error(`DMG 公证未通过：${result.status || '未知状态'}；提交 ID：${result.id || '无'}。请用 notarytool log 查看详情，禁止分发。`);
  }
  execute('xcrun', ['stapler', 'staple', dmg]);
  execute('xcrun', ['stapler', 'validate', dmg]);
  return { id: result.id, status: result.status };
}

function validateArchiveEntries(entries) {
  const required = ['package.json', 'desktop/main.cjs', 'desktop/site-preload.cjs', 'desktop/index.html',
    'tipsy-exporter/page.bundle.js', 'tipsy-exporter/bridge.bundle.js',
    'tipsy-exporter/cai-page.bundle.js', 'tipsy-exporter/cai-bridge.bundle.js',
    'tipsy-exporter/image-ref.js', 'tipsy-exporter/image-ref-config.js'];
  const files = entries.map(name => name.replace(/^\//, ''));
  for (const file of required) if (!files.includes(file)) throw Error(`安装包缺少运行文件：${file}`);
  for (const file of files) {
    if (!['desktop', 'tipsy-exporter', 'package.json'].includes(file) &&
        !/^desktop\/[^/]+\.(cjs|js|css|html)$/.test(file) &&
        !/^tipsy-exporter\/[^/]+\.js$/.test(file)) throw Error(`安装包含非运行文件：${file}`);
  }
}

function verifyApp(appPath, options, version, env) {
  const plist = path.join(appPath, 'Contents/Info.plist');
  const readPlist = key => run('plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim();
  if (readPlist('CFBundleShortVersionString') !== version) throw Error('安装包版本不一致。');
  if (readPlist('LSMinimumSystemVersion') !== '13.0') throw Error('安装包系统要求不一致。');
  const binary = path.join(appPath, 'Contents/MacOS', readPlist('CFBundleExecutable'));
  const arches = run('lipo', ['-archs', binary]).trim().split(/\s+/).sort();
  const expected = options.arch === 'universal' ? ['arm64', 'x86_64'] : [options.arch === 'x64' ? 'x86_64' : 'arm64'];
  if (JSON.stringify(arches) !== JSON.stringify(expected)) throw Error(`安装包架构不符：${arches.join(', ')}`);
  const asar = require('@electron/asar');
  const archive = path.join(appPath, 'Contents/Resources/app.asar');
  validateArchiveEntries(asar.listPackage(archive));
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (metadata.version !== version || metadata.main !== 'desktop/main.cjs') throw Error('ASAR 版本或启动入口不一致。');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (options.mode === 'release') {
    // -d writes signature details to stderr, even on success.
    const signature = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
    if (signature.status !== 0 || !signature.stderr.includes(`Authority=${env.CSC_NAME}\n`)) throw Error('正式包的 Developer ID 身份不符。');
    run('xcrun', ['stapler', 'validate', appPath]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  }
  return { architectures: arches, archiveChecked: true, codeSignatureChecked: true };
}

function verifyDmg(dmg, options, version, env) {
  run('hdiutil', ['verify', dmg]);
  const xml = run('hdiutil', ['attach', '-readonly', '-nobrowse', '-plist', dmg]);
  const attached = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }));
  const volumes = attached['system-entities'].filter(item => item['mount-point']);
  try {
    if (volumes.length !== 1) throw Error('DMG 挂载卷数量异常。');
    const volume = volumes[0]['mount-point'];
    const apps = fs.readdirSync(volume).filter(name => name.endsWith('.app'));
    if (apps.length !== 1) throw Error('DMG 应包含且仅包含一个应用。');
    if (fs.readlinkSync(path.join(volume, 'Applications')) !== '/Applications') throw Error('DMG 缺少 Applications 安装入口。');
    return verifyApp(path.join(volume, apps[0]), options, version, env);
  } finally {
    for (const volume of volumes) run('hdiutil', ['detach', volume['mount-point']]);
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (process.platform !== 'darwin') throw Error('macOS 安装包须在 Mac 构建。');
  const pkg = require('../package.json');
  const desktop = require('../desktop/package.json');
  if (pkg.version !== desktop.version) throw Error('请同步根目录与 desktop/package.json 的版本。');
  let env = { ...process.env };
  if (options.mode !== 'test') {
    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', ...(env.CSC_KEYCHAIN ? [env.CSC_KEYCHAIN] : [])]);
    env = signingEnvironment(env, identities);
    run('xcrun', ['notarytool', 'history', ...keychainArgs(env), '--output-format', 'json']);
    console.log('正式签名身份与公证凭据检查通过。');
    if (options.mode === 'check') return;
  }
  let electronDist;
  if (options.localElectron) {
    electronDist = path.join(root, 'desktop/node_modules/electron/dist');
    if (fs.readFileSync(path.join(electronDist, 'version'), 'utf8').trim().replace(/^v/, '') !== desktop.devDependencies.electron) throw Error('本地 Electron 版本不一致。');
  }
  run(process.execPath, [path.join(__dirname, 'build.cjs')], { stdio: 'inherit' });
  run('npm', ['test'], { stdio: 'inherit' });
  const base = path.join(root, options.mode === 'test' ? 'desktop/release' : 'desktop/release-notarized');
  fs.mkdirSync(base, { recursive: true });
  const staging = fs.mkdtempSync(path.join(base, '.build-'));
  console.log(`构建目录：${staging}（未完成验证前不可分发）`);
  const builder = require.resolve('electron-builder/cli.js');
  const config = options.mode === 'test' ? 'desktop/electron-builder.yml' : 'desktop/electron-builder.notarized.yml';
  run(process.execPath, [builder, '--projectDir', root, '--config', config, '--mac', 'dmg', `--${options.arch}`, '--publish', 'never',
    `-c.directories.output=${staging}`, ...(electronDist ? [`-c.electronDist=${electronDist}`] : [])], { env, stdio: 'inherit' });
  const dmgs = fs.readdirSync(staging).filter(file => file.endsWith('.dmg'));
  if (dmgs.length !== 1) throw Error('预期生成一个 DMG，停止发布。');
  const dmg = path.join(staging, dmgs[0]);
  const notarization = options.mode === 'release' ? notarizeDmg(dmg, env) : null;
  const checks = verifyDmg(dmg, options, pkg.version, env);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex');
  const commit = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = Boolean(run('git', ['status', '--porcelain']).trim());
  fs.writeFileSync(path.join(staging, 'SHA256SUMS'), `${sha256}  ${dmgs[0]}\n`);
  fs.writeFileSync(path.join(staging, 'release-report.json'), JSON.stringify({
    version: pkg.version, commit, dirty, createdAt: new Date().toISOString(), mode: options.mode,
    signedAndNotarized: options.mode === 'release', cleanMachineAcceptance: 'pending',
    artifact: dmgs[0], bytes: fs.statSync(dmg).size, sha256, minimumMacOS: '13.0', notarization, checks,
  }, null, 2) + '\n');
  const output = path.join(base, `${pkg.version}-${options.arch}-${path.basename(staging).slice(7)}`);
  fs.renameSync(staging, output);
  console.log(`${options.mode === 'test' ? '仅供开发测试，不可作为正式分发包' : '签名、公证及安装包检查通过；发版前仍需干净机器验收'}：\n${path.join(output, dmgs[0])}`);
}

module.exports = { parseArgs, signingEnvironment, notarizeDmg, validateArchiveEntries };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
