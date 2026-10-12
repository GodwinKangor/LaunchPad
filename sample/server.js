// LaunchPad sample application: a dependency-free HTTP server.
//
// Environment:
//   PORT         port to listen on (LaunchPad sets this from the project port)
//   GREETING     text shown on the page; change it and redeploy/restart to see env updates
//   FAIL_HEALTH  set to "true" to answer 503 everywhere and watch a deployment fail safely

const http = require('node:http');
const os = require('node:os');

const port = Number(process.env.PORT || 3000);
const greeting = process.env.GREETING || 'Hello from LaunchPad';
const failing = process.env.FAIL_HEALTH === 'true';
const startedAt = new Date();

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LaunchPad sample</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0c0f; color: #e8ebf0; font: 16px/1.5 system-ui, sans-serif; }
  main { padding: 2rem; max-width: 32rem; }
  h1 { margin: 0 0 1rem; font-size: 1.75rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .25rem 1rem; color: #8b94a3; font-size: .875rem; }
  dd { margin: 0; color: #e8ebf0; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(greeting)}</h1>
  <dl>
    <dt>Container</dt><dd>${escapeHtml(os.hostname())}</dd>
    <dt>Started</dt><dd>${startedAt.toISOString()}</dd>
    <dt>Node.js</dt><dd>${process.version}</dd>
  </dl>
</main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let status = 200;
  if (failing) {
    status = 503;
    res.writeHead(status, { 'Content-Type': 'text/plain' }).end('FAIL_HEALTH is set\n');
  } else if (url.pathname === '/healthz') {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  } else if (url.pathname === '/') {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(page());
  } else {
    status = 404;
    res.writeHead(status, { 'Content-Type': 'text/plain' }).end('Not found\n');
  }
  console.log(`${req.method} ${url.pathname} ${status}`);
});

server.listen(port, '0.0.0.0', () => console.log(`sample app listening on 0.0.0.0:${port}${failing ? ' (FAIL_HEALTH is set)' : ''}`));

// Exit promptly when the container is stopped or replaced.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
