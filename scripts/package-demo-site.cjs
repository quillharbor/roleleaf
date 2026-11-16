'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const record = JSON.parse(fs.readFileSync(path.join(root, 'docs/releases/demo.json')));
const output = path.join(root, 'dist/demo-site');
const source = path.join(root, 'site');
if (record.artifacts.length !== 2 || [...record.artifacts.map(x => x.platform)].sort().join(',') !== 'android,chrome') throw Error('Demo must contain exactly Android and Chrome.');
// Validate all inputs before replacing the previous generated bundle.
for (const artifact of record.artifacts) {
  if (path.basename(artifact.filename) !== artifact.filename) throw Error('Invalid artifact filename');
  const full = path.resolve(root, artifact.path);
  if (!full.startsWith(root + path.sep)) throw Error('Artifact outside candidate');
  const data = fs.readFileSync(full);
  if (data.length !== artifact.bytes || createHash('sha256').update(data).digest('hex') !== artifact.sha256) throw Error('Artifact verification failed: ' + artifact.platform);
}
for (const file of ['index.html', 'style.css', 'app.js', 'messages.js']) if (!fs.existsSync(path.join(source, file))) throw Error('Missing site file: ' + file);
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'files'), { recursive: true });
for (const file of ['style.css', 'app.js', 'messages.js']) fs.copyFileSync(path.join(source, file), path.join(output, file));
const indexHTML = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
fs.writeFileSync(path.join(output, 'index.html'),
  indexHTML.replace('src="release.js"', `src="release.js?v=${encodeURIComponent(record.version)}"`));
fs.copyFileSync(path.join(root, 'tipsy-exporter/i18n.js'), path.join(output, 'i18n.js'));
fs.copyFileSync(path.join(root, 'assets/brand/roleleaf-avatar-v1/roleleaf-anime-avatar.png'), path.join(output, 'logo.png'));
// The Pages workflow supplies its verified deployment URL and matching QR.
const publicRecord = { version: record.version, date: record.date, url: null, artifacts: record.artifacts.map(({ platform, filename, version, bytes, sha256, minimum }) => ({ platform, filename, version, bytes, sha256, minimum })) };
fs.writeFileSync(path.join(output, 'release.js'), 'window.ROLELEAF_RELEASE = ' + JSON.stringify(publicRecord) + ';\n');
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(publicRecord, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS'), record.artifacts.map(a => `${a.sha256}  ${a.filename}\n`).join(''));
for (const artifact of record.artifacts) fs.copyFileSync(path.join(root, artifact.path), path.join(output, 'files', artifact.filename));
fs.writeFileSync(path.join(output, 'files/index.html'), '<!doctype html><meta charset="utf-8"><title>RoleLeaf Demo files</title><h1>RoleLeaf Demo</h1>' + record.artifacts.map(a => `<p><a href="${encodeURIComponent(a.filename)}" download>${a.filename}</a></p>`).join(''));
const hostingOutput = path.join(root, 'dist/github-demo');
fs.rmSync(hostingOutput, { recursive: true, force: true });
fs.cpSync(path.join(root, 'demo-hosting'), hostingOutput, { recursive: true });
fs.cpSync(output, path.join(hostingOutput, 'docs'), { recursive: true });
fs.writeFileSync(path.join(hostingOutput, 'docs/.nojekyll'), '');
console.log(output);
console.log(hostingOutput);
