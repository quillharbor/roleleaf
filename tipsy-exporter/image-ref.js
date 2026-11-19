(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const b64alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let state = null, keyPromise = null;

  function b64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += b64alphabet[a >> 2] + b64alphabet[((a & 3) << 4) | (b >> 4)];
      if (i + 1 < bytes.length) out += b64alphabet[((b & 15) << 2) | (c >> 6)];
      if (i + 2 < bytes.length) out += b64alphabet[c & 63];
    }
    return out;
  }

  function pemBytes(pem) {
    const body = pem
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
    const binary = atob(body), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function configure(options = {}) {
    const publicKey = typeof options.publicKey === 'string' ? options.publicKey.trim() : '';
    const kid = typeof options.kid === 'string' ? options.kid.trim() : '';
    if (!publicKey) {
      state = null;
      keyPromise = null;
      return false;
    }
    if (!/^-----BEGIN PUBLIC KEY-----/.test(publicKey) ||
        !/-----END PUBLIC KEY-----$/.test(publicKey)) {
      throw Error('Image reference public key must be an SPKI PEM public key.');
    }
    if (!/^[\w.-]{1,64}$/.test(kid)) throw Error('Image reference kid is invalid.');
    state = { publicKey, kid };
    keyPromise = null;
    return true;
  }

  function enabled() {
    return Boolean(state);
  }

  function sourceInfo(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) {
        return { source_image_id: '', source_url: '' };
      }
      let sourceImageId = url.pathname.replace(/^\/+/, '');
      try { sourceImageId = decodeURIComponent(sourceImageId); } catch {}
      return { source_image_id: sourceImageId.slice(0, 1000), source_url: url.origin + url.pathname };
    } catch {
      return { source_image_id: '', source_url: '' };
    }
  }

  async function imageId({ platform, botId, role, sha256 }) {
    const canonical = JSON.stringify([
      'roleleaf-image-v1', platform, botId, role, sha256,
    ]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
    return 'img_' + b64url(digest.slice(0, 16));
  }

  async function rsaKey() {
    if (!state) throw Error('Image reference encryption is not configured.');
    keyPromise ||= crypto.subtle.importKey(
      'spki', pemBytes(state.publicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false, ['encrypt'],
    );
    return keyPromise;
  }

  async function encrypt({ platform, botId, role, url, file, sha256, mime }) {
    if (!state) throw Error('Image reference encryption is not configured.');
    if (typeof platform !== 'string' || !platform ||
        typeof botId !== 'string' || !botId ||
        typeof role !== 'string' || !role ||
        typeof file !== 'string' || !file ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw Error('Image reference fields are invalid.');
    }
    const header = {
      alg: 'RSA-OAEP-256',
      enc: 'A256GCM',
      kid: state.kid,
      cty: 'roleleaf-image-ref+json',
    };
    const protectedHeader = b64url(encoder.encode(JSON.stringify(header)));
    const source = sourceInfo(url);
    const payload = {
      v: 1,
      platform,
      bot_id: botId,
      role,
      source_image_id: source.source_image_id,
      source_url: source.source_url,
      file,
      sha256,
      ...(mime ? { mime } : {}),
    };
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt'],
    );
    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(protectedHeader), tagLength: 128 },
      aesKey, encoder.encode(JSON.stringify(payload)),
    ));
    const encryptedKey = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' }, await rsaKey(), rawKey,
    ));
    const tag = sealed.slice(-16), ciphertext = sealed.slice(0, -16);
    return {
      image_id: await imageId({ platform, botId, role, sha256 }),
      file,
      ...(mime ? { mime } : {}),
      ref: [
        protectedHeader, b64url(encryptedKey), b64url(iv), b64url(ciphertext), b64url(tag),
      ].join('.'),
    };
  }

  root.RoleLeafImageRef = Object.freeze({ configure, enabled, encrypt, imageId, sourceInfo });
})(globalThis);
