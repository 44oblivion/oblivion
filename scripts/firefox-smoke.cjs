#!/usr/bin/env node
// Development-only Firefox test. Creates a disposable extension copy and profile.
// The localhost permissions and test code NEVER enter a release package.
const fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http'),
  os = require('node:os'),
  { spawn } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'oblivion-firefox-'));
  let child;
  const reports = {};
  let finish;
  const result = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 50000) req.destroy();
      });
      req.on('end', () => {
        try {
          const message = JSON.parse(body);
          reports[message.kind] = message;
          res.writeHead(200);
          res.end('ok');
          if (message.error) finish.reject(Error(message.error));
          else if (reports.background && reports.content) finish.resolve(reports);
        } catch (error) {
          res.writeHead(400);
          res.end();
          finish.reject(error);
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><head><title>Oblivion runtime smoke fixture</title></head><body><main><h1>Disposable local test fixture</h1></main></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const extension = path.join(temp, 'extension');
    await fs.cp(path.join(root, 'extension'), extension, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
    manifest.permissions.push('http://127.0.0.1/*');
    manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
    manifest.content_scripts[0].js.unshift('content/runtime-capture.js');
    manifest.content_scripts[0].js.push('content/runtime-test.js');
    await fs.writeFile(
      path.join(extension, 'content/runtime-capture.js'),
      `globalThis.__oblivionRuntimeRoots=[];const originalAttachShadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=originalAttachShadow.call(this,options);globalThis.__oblivionRuntimeRoots.push(root);return root;};`,
    );
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    const html = await fs.readFile(path.join(extension, 'background/index.html'), 'utf8');
    await fs.writeFile(
      path.join(extension, 'background/index.html'),
      html.replace('</head>', '<script src="runtime-test.js"></script></head>'),
    );
    await fs.writeFile(
      path.join(extension, 'background/runtime-test.js'),
      `(async()=>{try{const state=await commands.state();if(state.preferences.bump.enabled||state.preferences.ai.consent)throw Error('Unsafe initial defaults');await Ledger.put('orders',[{id:'runtime-fixture',owner:'test',amount:5}]);const rows=await Ledger.all('orders');if(rows.length!==1)throw Error('IndexedDB persistence failed');await fetch(${JSON.stringify(origin + '/report')},{method:'POST',body:JSON.stringify({kind:'background',ok:true,version:api.runtime.getManifest().version,indexedDB:true,firefox:await browser.runtime.getBrowserInfo()})});}catch(error){await fetch(${JSON.stringify(origin + '/report')},{method:'POST',body:JSON.stringify({kind:'background',error:error.message})});}})();`,
    );
    await fs.writeFile(
      path.join(extension, 'content/runtime-test.js'),
      `setTimeout(async()=>{const host=document.querySelector('#oblivion-workspace');const root=globalThis.__oblivionRuntimeRoots.find(r=>r.host===host);const ready=!!root?.querySelector('.dock')&&!root.querySelector('.toast');await fetch(${JSON.stringify(origin + '/report')},{method:'POST',body:JSON.stringify(ready?{kind:'content',ok:true,mounted:true,dockReady:true}:{kind:'content',error:'Content workspace failed to mount'})});},1500);`,
    );
    const webext = path.join(root, 'node_modules/web-ext/bin/web-ext.js');
    const firefox =
      process.env.OBLIVION_FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
    child = spawn(
      process.execPath,
      [
        webext,
        'run',
        '--source-dir',
        extension,
        '--firefox',
        firefox,
        '--no-reload',
        '--no-config-discovery',
        '--start-url',
        origin,
      ],
      {
        cwd: root,
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1', MOZ_HEADLESS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    child.stdout.on('data', (b) => {
      log += b;
    });
    child.stderr.on('data', (b) => {
      log += b;
    });
    child.on('error', finish.reject);
    child.on('exit', (code) => {
      if (!reports.content || !reports.background)
        finish.reject(Error('Firefox exited ' + code + '\n' + log));
    });
    const timeout = setTimeout(
      () => finish.reject(Error('Firefox smoke test timed out\n' + log)),
      45000,
    );
    try {
      const report = await result;
      console.log(JSON.stringify(report, null, 2));
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (child && !child.killed) child.kill('SIGTERM');
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
