// One command to get demo-ready off your own machine: open a public tunnel, move the Vonage
// webhooks onto it, then start the server behind it.
//
// This exists because the alternative is a sequence you have to get right under time pressure -
// start tunnel, copy the URL out of scrolling output, paste it into .env, remember that webhooks
// live on the application and not on the call, update them, start the server - where forgetting
// any one step produces the same symptom: the phone rings and nothing happens, with no error
// anywhere, because the request never arrives.
require('dotenv').config();
const { spawn } = require('child_process');
const { updateWebhooks } = require('./update-webhooks');

const PORT = process.env.PORT || 3000;

// Use the real executable the package downloaded, not the .bin shim. On Windows the shim is a
// .cmd, which has to be run through a shell, and the shell does not reliably pass the child's
// stdout back - so the URL we are waiting for never arrives and this just hangs.
function cloudflaredBin() {
  try {
    return require('cloudflared').bin;
  } catch (e) {
    throw new Error('cloudflared is not installed. Run: npm install --no-save cloudflared');
  }
}

let child;
function stopTunnel() {
  if (child && !child.killed) child.kill();
}
process.on('exit', stopTunnel);
process.on('SIGINT', () => { stopTunnel(); process.exit(0); });
process.on('SIGTERM', () => { stopTunnel(); process.exit(0); });

function openTunnel() {
  return new Promise((resolve, reject) => {
    console.log('Opening a public tunnel...');
    child = spawn(cloudflaredBin(), ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // A quick tunnel prints its hostname once, on stderr, among a lot of other noise.
    let done = false;
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);

    child.on('error', (e) => reject(new Error(`Could not run cloudflared: ${e.message}`)));
    child.on('exit', (code) => {
      if (!done) reject(new Error(`cloudflared exited with code ${code} before printing a URL`));
    });

    const timer = setTimeout(() => {
      if (!done) reject(new Error('cloudflared did not print a URL within 60s'));
    }, 60000);
  });
}

(async () => {
  const url = await openTunnel();
  console.log(`Tunnel open: ${url}`);

  // index.js reads PUBLIC_URL at load, and dotenv does not overwrite what is already set,
  // so this has to happen before the require below.
  process.env.PUBLIC_URL = url;

  try {
    await updateWebhooks(url);
  } catch (e) {
    console.error('\n!! Could not move the Vonage webhooks:', e.message);
    console.error('   Incoming calls will go to the previous URL until this succeeds.\n');
  }

  console.log('');
  require('./index.js'); // prints its own banner, and checks that the tunnel really answers
  console.log(`\nOpen the storybook at: ${url}`);
  console.log('Ctrl+C closes the tunnel and the server together.\n');
})().catch((e) => {
  console.error(e.message);
  stopTunnel();
  process.exit(1);
});
