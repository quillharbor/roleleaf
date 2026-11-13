'use strict';

const { app, BrowserView, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const origins = { tipsy: 'https://tipsy.chat', character_ai: 'https://character.ai' };
const authOrigins = {
  tipsy: new Set(['https://auth2.tipsy.chat']),
  character_ai: new Set(['https://auth.character.ai', 'https://policies.character.ai']),
};
const appleDomain = 'apple.com';
const googleStorageOrigins = new Set([
  'https://accounts.google.com',
  'https://accounts.google.co.uk',
  'https://accounts.youtube.com',
]);
const googleDomains = new Set(String.raw`
google.com google.ad google.ae google.com.af google.com.ag google.al google.am google.co.ao
google.com.ar google.as google.at google.com.au google.az google.ba google.com.bd google.be
google.bf google.bg google.com.bh google.bi google.bj google.com.bn google.com.bo google.com.br
google.bs google.bt google.co.bw google.by google.com.bz google.ca google.cd google.cf google.cg
google.ch google.ci google.co.ck google.cl google.cm google.cn google.com.co google.co.cr
google.com.cu google.cv google.com.cy google.cz google.de google.dj google.dk google.dm
google.com.do google.dz google.com.ec google.ee google.com.eg google.es google.com.et google.fi
google.com.fj google.fm google.fr google.ga google.ge google.gg google.com.gh google.com.gi
google.gl google.gm google.gr google.com.gt google.gy google.com.hk google.hn google.hr google.ht
google.hu google.co.id google.ie google.co.il google.im google.co.in google.iq google.is
google.it google.je google.com.jm google.jo google.co.jp google.co.ke google.com.kh google.ki
google.kg google.co.kr google.com.kw google.kz google.la google.com.lb google.li google.lk
google.co.ls google.lt google.lu google.lv google.com.ly google.co.ma google.md google.me
google.mg google.mk google.ml google.com.mm google.mn google.com.mt google.mu google.mv google.mw
google.com.mx google.com.my google.co.mz google.com.na google.com.ng google.com.ni google.ne
google.nl google.no google.com.np google.nr google.nu google.co.nz google.com.om google.com.pa
google.com.pe google.com.pg google.com.ph google.com.pk google.pl google.pn google.com.pr
google.ps google.pt google.com.py google.com.qa google.ro google.ru google.rw google.com.sa
google.com.sb google.sc google.se google.com.sg google.sh google.si google.sk google.com.sl
google.sn google.so google.sm google.sr google.st google.com.sv google.td google.tg google.co.th
google.com.tj google.tl google.tm google.tn google.to google.com.tr google.tt google.com.tw
google.co.tz google.com.ua google.co.ug google.co.uk google.com.uy google.co.uz google.com.vc
google.co.ve google.co.vi google.com.vn google.vu google.ws google.rs google.co.za google.co.zm
google.co.zw google.cat
`.trim().split(/\s+/));
const googleCookieDomain = /(^|\.)(google|youtube)\.com$/i;
const types = new Set(['BOT_SIDEBAR', 'TIPSY_GET_CURRENT', 'TIPSY_CHAT', 'BOT_CAI']);
const actions = new Set(['status', 'start', 'cancel', 'export']);
const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };

function urlOf(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function isAppleURL(value) {
  const hostname = urlOf(value)?.hostname;
  return hostname === appleDomain || hostname?.endsWith(`.${appleDomain}`) === true;
}

function isGoogleAuthURL(value) {
  const hostname = urlOf(value)?.hostname;
  if (hostname === 'accounts.youtube.com') return true;
  return hostname?.startsWith('accounts.') === true && googleDomains.has(hostname.slice('accounts.'.length));
}

function cookieURL(cookie) {
  const host = cookie.domain.replace(/^\./, '');
  const path = cookie.path?.startsWith('/') ? cookie.path : '/';
  return `${cookie.secure ? 'https' : 'http'}://${host}${path}`;
}

function createPreload() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-site-'));
  const destination = path.join(folder, 'preload.cjs');
  const root = path.join(__dirname, '..', 'tipsy-exporter');
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const make = (page, bridge) => `{ page: ${JSON.stringify(read(page))}, bridge: function (chrome) {\n${read(bridge)}\n} }`;
  fs.writeFileSync(destination, `const CAPTURE_BUNDLES = Object.assign(Object.create(null), {\n` +
    `  '${origins.tipsy}': ${make('page.bundle.js', 'bridge.bundle.js')},\n` +
    `  '${origins.character_ai}': ${make('cai-page.bundle.js', 'cai-bridge.bundle.js')}\n` +
    `});\n${fs.readFileSync(path.join(__dirname, 'site-preload.cjs'), 'utf8')}`, { mode: 0o600 });
  app.once('will-quit', () => fs.rmSync(folder, { recursive: true, force: true }));
  return destination;
}

function attachSiteBrowser(window, authorize) {
  const views = new Map();
  const workers = new Map();
  const pending = new Map();
  const authResets = new Map();
  const googleFailures = new Map();
  let preload;
  let active;
  let visibleView;
  const emit = (channel, value) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value);
  };

  function tabs(platform) {
    const profile = session.fromPartition(`persist:bot-exporter-${platform}`);
    profile.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    profile.setPermissionCheckHandler(() => false);
    return profile;
  }

  async function resetGoogleAuth(profile) {
    const cookies = await profile.cookies.get({});
    for (const cookie of cookies) {
      if (googleCookieDomain.test(cookie.domain)) await profile.cookies.remove(cookieURL(cookie), cookie.name);
    }
    for (const origin of googleStorageOrigins) {
      await profile.clearStorageData({
        origin,
        storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      });
    }
    await profile.flushStorageData();
  }

  function noteGoogleFailure(platform) {
    const now = Date.now();
    const previous = googleFailures.get(platform);
    const count = previous && now - previous.started < 10 * 60 * 1000 ? previous.count + 1 : 1;
    googleFailures.set(platform, {
      count,
      started: previous && now - previous.started < 10 * 60 * 1000 ? previous.started : now,
    });
    return count;
  }

  function alertBlocked(platform, value) {
    if (active !== platform) return;
    const host = urlOf(value)?.hostname;
    emit('desktop:site-notice', host
      ? `RoleLeaf blocked sign-in navigation to ${host}.`
      : 'RoleLeaf blocked an invalid sign-in link.');
  }

  function guard(contents, platform, allowAuth, allowPopups) {
    const sameSite = url => urlOf(url)?.origin === origins[platform];
    const canOpen = url => sameSite(url) || (allowAuth &&
      (isAppleURL(url) || isGoogleAuthURL(url) ||
        authOrigins[platform]?.has(urlOf(url)?.origin)));
    const reject = (event, target) => {
      const url = typeof target === 'string' ? target : target?.url || event.url;
      if (canOpen(url)) return;
      event.preventDefault();
      alertBlocked(platform, url);
    };
    contents.on('will-navigate', reject);
    contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame === false || event.isMainFrame === false) return;
      reject(event, url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (allowPopups && (canOpen(url) || url === 'about:blank')) {
        return { action: 'allow', overrideBrowserWindowOptions: {
          parent: window, width: 650, height: 730,
          webPreferences: { ...webPreferences, session: tabs(platform), preload: undefined },
        } };
      }
      alertBlocked(platform, url);
      return { action: 'deny' };
    });
    if (allowPopups) contents.on('did-create-window', child => {
      const popup = child.webContents;
      guard(popup, platform, true, false);
      const recover = () => {
        if (!isGoogleAuthURL(popup.getURL()) || !/^(?:Error\s*)?400\b/i.test(popup.getTitle())) return;
        const now = Date.now();
        if (now - (authResets.get(platform) || 0) < 5000) return;
        authResets.set(platform, now);
        const repeated = noteGoogleFailure(platform) > 1;
        void resetGoogleAuth(tabs(platform)).then(() => {
          if (!child.isDestroyed()) child.close();
          if (active !== platform) return;
          emit('desktop:site-notice', repeated
            ? 'Google sign-in keeps failing. Try Apple or an email verification code.'
            : 'Google sign-in data was reset. Try signing in again.');
          if (repeated) emit('desktop:site-auth-fallback',
            'Google sign-in keeps failing. Try Apple or an email verification code.');
        }).catch(() => {
          if (active !== platform) return;
          emit('desktop:site-notice', 'Could not reset Google sign-in. Try Apple or email.');
          emit('desktop:site-auth-fallback',
            'Could not recover Google sign-in. Try Apple or an email verification code.');
        });
      };
      popup.on('page-title-updated', recover);
      popup.on('did-stop-loading', recover);
    });
  }

  function size() {
    if (!visibleView) return;
    const [width, height] = window.getContentSize();
    visibleView.setBounds({ x: 0, y: 121, width: Math.max(0, width - 360), height: Math.max(0, height - 121) });
  }

  function display(view) {
    if (visibleView === view) return;
    if (WebContentsView) {
      if (visibleView) window.contentView.removeChildView(visibleView);
      if (view) window.contentView.addChildView(view);
    } else {
      if (visibleView) window.removeBrowserView(visibleView);
      if (view) window.addBrowserView(view);
    }
    visibleView = view;
    size();
  }

  function create(platform, worker = false) {
    preload ||= createPreload();
    const preferences = {
      ...webPreferences, preload, session: tabs(platform), backgroundThrottling: !worker,
    };
    const View = WebContentsView || BrowserView;
    const view = worker
      ? new BrowserWindow({ show: false, width: 1000, height: 740, paintWhenInitiallyHidden: true, webPreferences: preferences })
      : new View({ webPreferences: preferences });
    const contents = view.webContents;
    guard(contents, platform, !worker, !worker);
    if (!worker) {
      let error = '';
      const status = () => {
        if (active !== platform) return;
        const url = urlOf(contents.getURL());
        emit('desktop:site-state', { platform, loading: contents.isLoadingMainFrame(),
          url: url ? url.origin + url.pathname : origins[platform], error });
      };
      contents.on('did-start-loading', () => { error = ''; status(); });
      for (const event of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page']) {
        contents.on(event, () => status());
      }
      contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3) { error = `Page failed to load (${code}). Check your connection and refresh.`; status(); }
      });
    }
    return view;
  }

  function activeContents() {
    return active ? views.get(active)?.webContents : null;
  }

  function contentsFor(id) {
    const content = activeContents();
    return content?.id === id ? content : workers.get(id)?.webContents;
  }

  function load(contents, url) {
    return contents.loadURL(url).catch(error => {
      if (error.code !== 'ERR_ABORTED') throw Error(`Page failed to load (${error.code || 'network error'}).`);
    });
  }

  const handle = (channel, handler) => ipcMain.handle(`desktop:${channel}`, (event, ...args) => {
    authorize(event);
    return handler(...args);
  });

  handle('site-switch', async platform => {
    if (platform !== null && !Object.hasOwn(origins, platform)) throw Error('Unsupported platform.');
    active = platform;
    if (!platform) { display(null); return; }
    let view = views.get(platform);
    const first = !view;
    if (first) { view = create(platform); views.set(platform, view); }
    display(view);
    if (first) await load(view.webContents, origins[platform]);
  });
  handle('site-navigation', async (action, value) => {
    const content = activeContents();
    if (!content) return;
    if (action === 'back') {
      const history = content.navigationHistory || content;
      if (history.canGoBack()) history.goBack();
    } else if (action === 'refresh') content.reload();
    else if (action === 'open') {
      const url = urlOf(value);
      if (url?.origin !== origins[active]) throw Error('Enter an HTTPS link for the current site.');
      await load(content, url.href);
    }
  });
  handle('site-current', () => {
    const contents = activeContents();
    const url = urlOf(contents?.getURL());
    if (!contents || url?.origin !== origins[active]) return null;
    return { id: contents.id, url: url.href, title: contents.getTitle() };
  });
  handle('site-tab', id => {
    const contents = contentsFor(id);
    const url = urlOf(contents?.getURL());
    if (contents && workers.has(id) && !url && contents.isLoadingMainFrame()) return { id, url: '' };
    if (!contents || url?.origin !== origins[active]) throw Error('Chat page is unavailable.');
    return { id, url: url.href };
  });
  handle('site-worker', value => {
    const url = urlOf(value);
    if (!active || url?.origin !== origins[active] || !/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?chat\/[\w-]+\/?$/i.test(url.pathname)) {
      throw Error('The chat link belongs to a different platform.');
    }
    const view = create(active, true);
    const contents = view.webContents;
    const id = contents.id;
    workers.set(id, view);
    void load(contents, url.href).catch(() => {});
    return id;
  });
  handle('site-close', id => {
    const view = workers.get(id);
    if (view) { workers.delete(id); view.destroy(); }
  });
  handle('site-request', (id, message) => {
    const contents = contentsFor(id);
    if (!contents || urlOf(contents.getURL())?.origin !== origins[active] || !types.has(message?.type) ||
        (message.action && !actions.has(message.action))) return { ok: false, reason: 'unavailable' };
    return new Promise((resolve, reject) => {
      const key = randomUUID();
      const timer = setTimeout(() => { pending.delete(key); reject(Error('Chat capture is unavailable. Refresh the page and try again.')); }, 5500);
      pending.set(key, { contents, resolve, timer });
      try { contents.send('desktop:site-request', key, message); }
      catch (error) { clearTimeout(timer); pending.delete(key); reject(error); }
    });
  });
  ipcMain.on('desktop:site-response', (event, key, result) => {
    const request = pending.get(key);
    if (request?.contents !== event.sender || event.senderFrame !== event.sender.mainFrame) return;
    clearTimeout(request.timer);
    pending.delete(key);
    request.resolve(result);
  });
  window.on('resize', size);
  window.on('closed', () => {
    for (const worker of workers.values()) if (!worker.isDestroyed()) worker.destroy();
    for (const view of views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  });
}

module.exports = { attachSiteBrowser };
