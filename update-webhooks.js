// Point the Vonage application at wherever this server is actually reachable.
//
// The answer and event webhooks are baked into the Vonage application, not into a call. If the
// public URL moves - a Codespace rebuilt, a tunnel restarted, a switch from Codespaces to ngrok -
// every incoming call silently fails: Vonage dials a dead host, the caller hears nothing, and no
// error reaches this server because the request never got here. Run this after any move.
//
// Usable two ways: `npm run webhooks` from the shell, or updateWebhooks(url) from tunnel.js,
// which knows its URL before the server has started.
require('dotenv').config();
const { Vonage } = require('@vonage/server-sdk');

function defaultBaseUrl() {
  const port = process.env.PORT || 3000;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
  return (
    process.env.PUBLIC_URL ||
    (process.env.CODESPACE_NAME
      ? `https://${process.env.CODESPACE_NAME}-${port}.${domain}`
      : `http://localhost:${port}`)
  );
}

async function updateWebhooks(baseUrl = defaultBaseUrl()) {
  const appId = process.env.API_APPLICATION_ID;
  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;

  if (!appId || !apiKey || !apiSecret) {
    throw new Error('Need API_APPLICATION_ID, VONAGE_API_KEY and VONAGE_API_SECRET in .env');
  }
  if (/localhost/.test(baseUrl)) {
    throw new Error(
      `BASE_URL is ${baseUrl} - Vonage cannot reach that. Set PUBLIC_URL to a tunnel URL first.`
    );
  }

  const vonage = new Vonage({ apiKey, apiSecret }, { debug: false });
  console.log(`Pointing Vonage application ${appId} at ${baseUrl}`);
  const app = await vonage.applications.getApplication(appId);

  // Keep whatever else the application has; only the addresses move.
  app.capabilities = app.capabilities || {};
  app.capabilities.voice = {
    ...(app.capabilities.voice || {}),
    webhooks: {
      answer_url: { address: `${baseUrl}/voice/answer`, http_method: 'GET' },
      event_url: { address: `${baseUrl}/voice/event`, http_method: 'POST' },
    },
  };
  app.capabilities.rtc = {
    ...(app.capabilities.rtc || {}),
    webhooks: {
      event_url: { address: `${baseUrl}/webhooks/rtcevent`, http_method: 'POST' },
    },
  };

  await vonage.applications.updateApplication(app);

  // Read it back. What we sent is not evidence of what landed.
  const after = await vonage.applications.getApplication(appId);
  const voice = after.capabilities?.voice?.webhooks || {};
  console.log('  answer ->', voice.answer_url?.address);
  console.log('  event  ->', voice.event_url?.address);
  return after;
}

module.exports = { updateWebhooks, defaultBaseUrl };

if (require.main === module) {
  updateWebhooks()
    .then(() => console.log('\nNow start the server and check the reachability line it prints.'))
    .catch((e) => {
      console.error('Could not update the application:', e?.response?.data || e.message);
      process.exit(1);
    });
}
