// Point the Vonage application at wherever this server is actually reachable.
//
// The answer and event webhooks are baked into the Vonage application, not into a call. If the
// public URL moves - a Codespace rebuilt, a tunnel restarted, a switch from Codespaces to ngrok -
// every incoming call silently fails: Vonage dials a dead host, the caller hears nothing, and no
// error reaches this server because the request never got here. Run this after any move.
require('dotenv').config();
const { Vonage } = require('@vonage/server-sdk');

const port = process.env.PORT || 3000;
const CODESPACE_DOMAIN =
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const BASE_URL =
  process.env.PUBLIC_URL ||
  (process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-${port}.${CODESPACE_DOMAIN}`
    : `http://localhost:${port}`);

const appId = process.env.API_APPLICATION_ID;
const apiKey = process.env.VONAGE_API_KEY;
const apiSecret = process.env.VONAGE_API_SECRET;

if (!appId || !apiKey || !apiSecret) {
  console.error('Need API_APPLICATION_ID, VONAGE_API_KEY and VONAGE_API_SECRET in .env');
  process.exit(1);
}
if (/localhost/.test(BASE_URL)) {
  console.error(`BASE_URL is ${BASE_URL} - Vonage cannot reach that.`);
  console.error('Set PUBLIC_URL to your tunnel URL first, e.g.');
  console.error('  PUBLIC_URL=https://something.trycloudflare.com');
  process.exit(1);
}

const vonage = new Vonage({ apiKey, apiSecret }, { debug: false });

(async () => {
  console.log(`Pointing application ${appId} at ${BASE_URL}`);
  const app = await vonage.applications.getApplication(appId);

  // Keep whatever else the application has; only the addresses move.
  app.capabilities = app.capabilities || {};
  app.capabilities.voice = {
    ...(app.capabilities.voice || {}),
    webhooks: {
      answer_url: { address: `${BASE_URL}/voice/answer`, http_method: 'GET' },
      event_url: { address: `${BASE_URL}/voice/event`, http_method: 'POST' },
    },
  };
  app.capabilities.rtc = {
    ...(app.capabilities.rtc || {}),
    webhooks: {
      event_url: { address: `${BASE_URL}/webhooks/rtcevent`, http_method: 'POST' },
    },
  };

  await vonage.applications.updateApplication(app);

  const after = await vonage.applications.getApplication(appId);
  const voice = after.capabilities?.voice?.webhooks || {};
  console.log('');
  console.log('Voice answer :', voice.answer_url?.address);
  console.log('Voice event  :', voice.event_url?.address);
  console.log('RTC event    :', after.capabilities?.rtc?.webhooks?.event_url?.address);
  console.log('');
  console.log('Now start the server and check the reachability line it prints.');
})().catch((e) => {
  console.error('Could not update the application:', e?.response?.data || e.message);
  process.exit(1);
});
