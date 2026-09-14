import { readFile } from "node:fs/promises";

import { chromium, devices } from "playwright-core";
import { getDomain } from "tldts";

// Most common "accept cookies" buttons: with consent, sites load all of their ads.
const CONSENT_SELECTORS = [
	"#onetrust-accept-btn-handler",
	"#didomi-notice-agree-button",
	"button.fc-cta-consent",
	'.qc-cmp2-summary-buttons button[mode="primary"]',
	"#truste-consent-button",
	'[data-testid="uc-accept-all-button"]',
	"button.sp_choice_type_11",
	"#accept-choices",
];
const CONSENT_TEXT =
	/^\s*(accept( all)?( cookies)?|agree|i agree|allow all|got it|tout accepter|accepter( et fermer)?|j'accepte|aceptar( todo)?|acepto|consentir|alle akzeptieren|akzeptieren|accetta( tutto)?|accetto|aceitar( tudo)?|alles accepteren|accepteren)\s*$/i;

/** URL of the script/document that started a request (Chrome DevTools initiator). */
export function initiatorUrl(init) {
	if (!init) return "";
	for (let s = init.stack; s; s = s.parent) {
		const frame = s.callFrames?.find((c) => c.url);
		if (frame) return frame.url;
	}
	return init.url || "";
}

const BROWSER_NAMES = { chrome: "Chrome", msedge: "Edge" };
const OS_TOKENS = {
	darwin: "Macintosh; Intel Mac OS X 10_15_7",
	win32: "Windows NT 10.0; Win64; x64",
};

/** Desktop user agent matching the host OS and browser (headless Chrome says "HeadlessChrome"). */
export function desktopUserAgent(
	version,
	channel,
	platform = process.platform,
) {
	const major = version.split(".")[0];
	const os = OS_TOKENS[platform] || "X11; Linux x86_64";
	const edge = channel === "msedge" ? ` Edg/${major}.0.0.0` : "";
	return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${edge}`;
}

async function launch(headed) {
	// Installed Chrome first (less likely to be flagged as a bot), then Edge, then Playwright's Chromium.
	let last;
	for (const channel of ["chrome", "msedge", undefined]) {
		try {
			const browser = await chromium.launch({
				channel,
				headless: !headed,
				args: ["--disable-blink-features=AutomationControlled"],
			});
			return { browser, channel };
		} catch (e) {
			last = e;
		}
	}
	throw new Error(
		"No browser found. Install Google Chrome, or run: pnpm exec playwright-core install chromium\n" +
			`  (${last?.message.split("\n")[0]})`,
	);
}

async function acceptConsent(page) {
	for (const frame of page.frames()) {
		const candidates = [
			...CONSENT_SELECTORS.map((sel) => frame.locator(sel).first()),
			frame.getByRole("button", { name: CONSENT_TEXT }).first(),
		];
		for (const loc of candidates) {
			if (await loc.isVisible().catch(() => false)) {
				await loc.click({ timeout: 2000 }).catch(() => {});
				return true;
			}
		}
	}
	return false;
}

/** Closest http(s) URL walking up the frame tree (ad iframes are often about:blank). */
function frameSourceUrl(frame) {
	for (let f = frame; f; f = f.parentFrame()) {
		if (/^https?:/.test(f.url())) return f.url();
	}
	return "";
}

/**
 * Opens the page in a headless browser and records every network request.
 * → { requestedUrl, finalUrl, title, browser, requests: [{ url, type, sourceUrl, initiatorUrl, popup, failed }], popups, redirects }
 */
export async function capture(
	url,
	{
		mobile = false,
		wait = 20,
		click = false,
		headed = false,
		log = () => {},
	} = {},
) {
	const { browser, channel } = await launch(headed);
	const out = {
		requestedUrl: url,
		finalUrl: url,
		title: "",
		browser: `${BROWSER_NAMES[channel] || "Chromium"} ${browser.version()}`,
		requests: [],
		popups: [],
		redirects: [],
	};
	try {
		const { defaultBrowserType, ...iphone } = devices["iPhone 15 Pro"];
		const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
		const context = await browser.newContext({
			...(mobile
				? iphone
				: {
						viewport: { width: 1440, height: 900 },
						userAgent: desktopUserAgent(browser.version(), channel),
					}),
			locale,
			timezoneId: timeZone,
		});
		await context.addInitScript(() =>
			Object.defineProperty(navigator, "webdriver", { get: () => undefined }),
		);
		const page = await context.newPage();

		// Initiators via CDP: which script requested each resource (used to follow ad chains).
		const initiators = new Map();
		try {
			const cdp = await context.newCDPSession(page);
			await cdp.send("Network.enable");
			cdp.on("Network.requestWillBeSent", (e) => {
				if (!initiators.has(e.request.url))
					initiators.set(e.request.url, initiatorUrl(e.initiator));
			});
		} catch {}

		const byRequest = new WeakMap();
		context.on("request", (req) => {
			let sourceUrl = "";
			let type = req.resourceType();
			let popup = false;
			try {
				const frame = req.frame();
				popup = frame.page() !== page;
				if (type === "document") {
					const isMain = frame === frame.page().mainFrame();
					type = isMain ? "main_frame" : "sub_frame";
					sourceUrl = isMain ? "" : frameSourceUrl(frame.parentFrame());
				} else {
					sourceUrl = frameSourceUrl(frame);
				}
			} catch {} // service worker requests have no frame
			const entry = {
				url: req.url(),
				type,
				sourceUrl,
				initiatorUrl: req.redirectedFrom()?.url() || "",
				popup,
				failed: false,
			};
			byRequest.set(req, entry);
			out.requests.push(entry);
		});
		context.on("requestfailed", (req) => {
			const entry = byRequest.get(req);
			if (entry) entry.failed = req.failure()?.errorText || true;
		});
		context.on("page", (p) => {
			if (p === page) return;
			if (/^https?:/.test(p.url())) out.popups.push(p.url());
			p.on(
				"framenavigated",
				(f) => f === p.mainFrame() && out.popups.push(f.url()),
			);
		});
		page.on("websocket", (ws) =>
			out.requests.push({
				url: ws.url(),
				type: "websocket",
				sourceUrl: page.url(),
				initiatorUrl: "",
				popup: false,
			}),
		);

		log("opening the page…");
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
		} catch (e) {
			log(`warning: ${e.message.split("\n")[0]} (continuing with what loaded)`);
		}
		await page.waitForTimeout(2500);
		if (await acceptConsent(page)) {
			log("cookie banner accepted");
			await page.waitForTimeout(2000);
		}

		log(`scrolling for ${wait}s to load ads…`);
		const end = Date.now() + wait * 1000;
		while (Date.now() < end) {
			await page
				.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
				.catch(() => {});
			await page.waitForTimeout(1000);
		}

		if (click) {
			// Pop-unders fire on the first click anywhere on the page.
			const site = getDomain(url);
			const { width, height } = page.viewportSize() || {
				width: 800,
				height: 600,
			};
			for (let i = 0; i < 2; i++) {
				log(`click ${i + 1}/2 to detect pop-ups…`);
				await (mobile
					? page.touchscreen.tap(width / 2, height / 2)
					: page.mouse.click(width / 2, height / 2)
				).catch(() => {});
				await page.waitForTimeout(3000);
				if (getDomain(page.url()) !== site) {
					out.redirects.push(page.url());
					await page.goBack({ timeout: 15000 }).catch(() => {});
					await page.waitForTimeout(1500);
				}
			}
		}

		await page
			.waitForLoadState("networkidle", { timeout: 5000 })
			.catch(() => {});
		out.finalUrl = page.url();
		out.title = await page.title().catch(() => "");
		for (const r of out.requests) {
			r.initiatorUrl = initiators.get(r.url) || r.initiatorUrl;
		}
	} finally {
		await browser.close();
	}
	return out;
}

/** Reads a .har exported from DevTools (Chrome/Safari/Firefox) into the same shape as capture(). */
export async function fromHar(path) {
	const har = JSON.parse(await readFile(path, "utf8"));
	const entries = har.log?.entries || [];
	const doc = entries.find((e) => e._resourceType === "document") || entries[0];
	const pageUrl = doc?.request.url || "";
	return {
		requestedUrl: pageUrl,
		finalUrl: pageUrl,
		title: har.log?.pages?.[0]?.title || "",
		browser: `HAR (${har.log?.creator?.name || "?"})`,
		popups: [],
		redirects: [],
		requests: entries.map((e) => ({
			url: e.request.url,
			type: e === doc ? "main_frame" : e._resourceType || "other",
			sourceUrl: pageUrl,
			initiatorUrl: initiatorUrl(e._initiator),
			popup: false,
			failed: e.response?.status === 0,
		})),
	};
}
