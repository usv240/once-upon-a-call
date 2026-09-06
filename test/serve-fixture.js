// Static fixture server for the layout test.
//
// index.js refuses to boot without real Vonage credentials, which is correct for the app but
// makes the overlay untestable on a laptop with no .env. This serves the same pages and stubs
// the handful of endpoints landing.js calls, so `node test/layout.test.js` runs anywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp' };

const STUBS = {
  '/api/info': { phone: '12018903507', phoneFormatted: '+1 (201) 890-3507', title: 'The Little Dragon Who Couldn\'t Sleep', childName: 'Maya', parentName: 'Dad', pinRequired: true },
  '/api/state': { page: 0, totalPages: 4, inCall: false, recordings: 0 },
  '/api/recordings': [],
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (STUBS[url]) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(STUBS[url]));
  }
  if (url === '/api/stories') {
    const dir = path.join(ROOT, 'static/stories');
    const stories = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((s) => ({ id: s.id, title: s.title, character: s.character, pages: s.pages.length }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ active: stories[0] && stories[0].id, stories }));
  }
  if (url === '/api/story') {
    const id = (req.url.split('id=')[1] || 'dragon').split('&')[0];
    const file = path.join(ROOT, 'static/stories', `${path.basename(id)}.json`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(fs.readFileSync(fs.existsSync(file) ? file : path.join(ROOT, 'static/stories/dragon.json')));
  }
  // socket.io is not running here; hand back an empty script so `typeof io === 'undefined'`
  // and landing.js takes its no-socket path instead of throwing.
  if (url.startsWith('/socket.io/')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('/* no socket in fixture mode */');
  }

  const rel = url === '/' ? 'pages/index.html' : url.slice(1);
  for (const dir of ['pages', 'static', 'test', '.']) {
    const file = path.join(ROOT, dir, rel.replace(/^(pages|static)\//, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
  }
  res.writeHead(404).end('not found');
});

const port = Number(process.argv[2]) || 3210;
server.listen(port, () => console.log(`fixture server on http://localhost:${port}/`));
