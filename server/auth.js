const auth = require('basic-auth');

/**
 * Create a basic authentication middleware function that checks
 * against the given credentials.
 */
exports.basicAuth = (username, password) => {
  if (!username || !password) {
    throw new Error('Missing required username and password for basic authentication.');
  }

  return (req, res, next) => {
    const user = auth(req);

    if (user && user.name === username && user.pass === password) {
      next();
    } else {
      res
        .set({ 'WWW-Authenticate': 'Basic realm="Authentication required"' })
        .status(401)
        .end("I'm afraid I cannot let you do that.");
    }
  };
};

// XOLOLO: bots de redes sociales que requieren leer OG/meta tags para
// generar link previews. Estos bots no envían Basic Auth y recibirían
// 401, con lo que FB/WhatsApp/Twitter/LinkedIn/Slack/Discord/Telegram
// nunca podrían armar el preview card al compartir un listing.
// Lista basada en los user-agents públicos de cada plataforma:
//   facebookexternalhit, Facebot — Facebook / Messenger
//   Twitterbot — X / Twitter
//   LinkedInBot — LinkedIn
//   WhatsApp — WhatsApp link preview (iOS/Android)
//   TelegramBot — Telegram
//   Slackbot, Slackbot-LinkExpanding — Slack
//   Discordbot — Discord
//   SkypeUriPreview — Skype / Teams
//   Applebot — iMessage link preview + Mail
//   Pinterestbot — Pinterest
//   redditbot — Reddit
//   vkShare — VK
const SOCIAL_PREVIEW_BOT_UA = /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|skypeuripreview|applebot|pinterest|redditbot|vkshare/i;

/**
 * Same as basicAuth but transparently bypasses the challenge for
 * known social-preview bots so that og:title/description/image can be
 * fetched without credentials. Humans still see the auth prompt.
 */
exports.basicAuthWithSocialBypass = (username, password) => {
  const base = exports.basicAuth(username, password);
  return (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (SOCIAL_PREVIEW_BOT_UA.test(ua)) return next();
    return base(req, res, next);
  };
};
