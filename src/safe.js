import { getDomain, getDomainWithoutSuffix } from "tldts";

// Domains adhunt never proposes to block even when a rule matches:
// blocking them at the DNS level would break sites or services for the whole network.
// A subdomain can still be blocked if EasyList targets it (e.g. adservice.google.com).
// To add a domain, use its registrable form (example.com, not www.example.com) and
// explain in the pull request what breaks when it is blocked.
export const SAFE = new Set([
	// Google / YouTube / Apple / Microsoft / Amazon
	"google.com",
	"googleapis.com",
	"gstatic.com",
	"googleusercontent.com",
	"youtube.com",
	"youtube-nocookie.com",
	"ytimg.com",
	"googlevideo.com",
	"recaptcha.net",
	"apple.com",
	"icloud.com",
	"mzstatic.com",
	"apple-dns.net",
	"aaplimg.com",
	"microsoft.com",
	"live.com",
	"office.com",
	"office.net",
	"msn.com",
	"bing.com",
	"windows.net",
	"amazon.com",
	"amazonaws.com",
	"media-amazon.com",
	"ssl-images-amazon.com",
	// CDNs and infrastructure
	"cloudflare.com",
	"cloudflare.net",
	"jsdelivr.net",
	"unpkg.com",
	"jquery.com",
	"bootstrapcdn.com",
	"fontawesome.com",
	"typekit.net",
	"akamaihd.net",
	"akamaized.net",
	"akamai.net",
	"edgekey.net",
	"edgesuite.net",
	"cloudfront.net",
	"fastly.net",
	"fastly.com",
	"fastlylb.net",
	"azureedge.net",
	"azurefd.net",
	"b-cdn.net",
	"hcaptcha.com",
	"gravatar.com",
	"wp.com",
	"wordpress.com",
	"github.com",
	"githubusercontent.com",
	"githubassets.com",
	"wikipedia.org",
	"wikimedia.org",
	// Social networks, video, payments
	"facebook.com",
	"fbcdn.net",
	"instagram.com",
	"cdninstagram.com",
	"twitter.com",
	"x.com",
	"twimg.com",
	"tiktok.com",
	"tiktokcdn.com",
	"reddit.com",
	"redditmedia.com",
	"redditstatic.com",
	"linkedin.com",
	"licdn.com",
	"pinterest.com",
	"pinimg.com",
	"vimeo.com",
	"vimeocdn.com",
	"jwplayer.com",
	"jwpcdn.com",
	"twitch.tv",
	"spotify.com",
	"paypal.com",
	"paypalobjects.com",
	"stripe.com",
	"stripe.network",
	"shopify.com",
	"shopifycdn.com",
	"squarespace.com",
	"wix.com",
	"wixstatic.com",
	"discord.com",
	// Mail, messaging, push and system services (noise in device mode)
	"akadns.net",
	"akamaiedge.net",
	"me.com",
	"gmail.com",
	"office365.com",
	"outlook.com",
	"cloud.microsoft",
	"whatsapp.net",
	"whatsapp.com",
	"dns.google",
	"chatgpt.com",
	"openai.com",
	"anthropic.com",
	"claude.ai",
	"twilio.com",
	"zoom.us",
	"slack.com",
	"tailscale.com",
]);

// They match blocking rules but tend to break features (login, embeds,
// checkout): shown under "review", never preselected.
export const RISKY_TARGETS = new Set([
	"googletagmanager.com",
	"www.googletagmanager.com",
	"connect.facebook.net",
	"facebook.net",
	"cdn.segment.com",
	"segment.io",
	"cdn.branch.io",
	"app.link",
	"newrelic.com",
	"js-agent.newrelic.com",
	"sentry.io",
	"browser.sentry-cdn.com",
	"cdn.optimizely.com",
]);

/** true if a rule may not target this exact domain: a SAFE domain or a Google country domain (google.co.uk…). */
export const isProtected = (domain) =>
	SAFE.has(domain) ||
	(getDomainWithoutSuffix(domain) === "google" && getDomain(domain) === domain);

/** true if host is a protected domain or a subdomain of one. */
export function isSafe(host) {
	for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
		if (isProtected(h)) return true;
	}
	return false;
}
