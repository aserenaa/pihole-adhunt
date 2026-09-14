#!/usr/bin/env node
import { isIP } from "node:net";
import { parseArgs, styleText } from "node:util";

import { analyze, finalize, loadEngines } from "./analyze.js";
import { capture, fromHar } from "./capture.js";
import { CACHE_DIR, loadConfig, readConfigFile, saveConfig } from "./config.js";
import {
	forgetPassword,
	keychainName,
	readPassword,
	savePassword,
	storedPassword,
} from "./credentials.js";
import { selectCandidates } from "./menu.js";
import { pageUrl, parseSelection, piholeUrl, wholeNumber } from "./options.js";
import {
	findGroup,
	fromWildcard,
	isBlockedStatus,
	isInsecureRemoteUrl,
	makeDnsChecker,
	toWildcard,
	withPiHole,
} from "./pihole.js";
import {
	loadHistory,
	loadLastScan,
	saveHistory,
	saveLastScan,
} from "./state.js";
import { exitWhenFlushed, printable, prompt } from "./terminal.js";

const LOCAL_NAMES = /\.(lan|local|localdomain|home|internal|arpa|ts\.net)$/;

const tty = process.stdout.isTTY;
// https://no-color.org: any non-empty NO_COLOR turns colors off.
const color = tty && !process.env.NO_COLOR;
const c = (style, text) =>
	color ? styleText(style, String(text)) : String(text);
const say = (...a) => console.log(...a);
const note = (msg) => process.stderr.write(c("dim", `  · ${msg}\n`));
const warn = (msg) => process.stderr.write(c("yellow", `  ! ${msg}\n`));

const HELP = `adhunt — find the ad domains a page loads and block them in Pi-hole

Usage:
  adhunt <url> [options]             scan a page (shortcut for "scan")
  adhunt scan <url> [options]
  adhunt block <selection>           block from the last scan without the menu: r (recommended), 1 3 5-7
  adhunt undo                        undo the last block
  adhunt list                        everything adhunt added to Pi-hole
  adhunt remove <domain>             remove a domain added by adhunt
  adhunt device <ip> [--minutes 15]  analyze what a device asked for (Pi-hole query log)
  adhunt clients                     devices with the most queries (to find an IP)
  adhunt setup                       set the Pi-hole URL and store the password in the system keychain
  adhunt logout                      remove the stored password

Scan options:
  -m, --mobile      emulate an iPhone (sites serve different ads on mobile)
  -w, --wait <s>    seconds to scroll while waiting for ads (default 20, max 300)
      --click       click the page to detect pop-ups/pop-unders
      --headed      show the browser (useful when a site detects bots)
      --har <file>  analyze a .har exported from DevTools instead of opening a browser
  -y, --yes         block the recommended entries without asking
      --json        print the result as JSON
  -g, --group <g>   add blocked domains to this Pi-hole group, by name or id (default: Default)
      --no-menu     type the selection (r, 1 3 5-7) instead of using the menu

Choosing what to block:
  ↑↓ move · space mark or unmark · r recommended · n none · enter confirm · esc cancel
  The menu needs an interactive terminal; with --no-menu or TERM=dumb you type the numbers.
`;

const GROUPS = {
	block: {
		title: "🔴 BLOCK — ads/trackers with a full-domain EasyList rule",
		color: "red",
	},
	review: {
		title: "🟠 REVIEW — likely ads, but blocking may break something",
		color: "yellow",
	},
	unknown: {
		title:
			"🟡 UNKNOWN — third parties with no matching rule (check whether any look like ads)",
		color: "dim",
	},
};

const shown = (cand) =>
	cand.kind === "regex"
		? `${cand.target} ${c("dim", "(+subdomains)")}`
		: cand.target;
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (list, n = 6) =>
	list.length > n
		? `${list.slice(0, n).join(", ")} … +${list.length - n}`
		: list.join(", ");

/** list: false leaves the candidates out, for when the selection menu shows them. */
function printReport(scan, { list = true } = {}) {
	say("");
	say(c("bold", `adhunt · ${printable(scan.finalUrl || scan.site)}`));
	const summary = [
		printable(scan.title).slice(0, 70),
		printable(scan.browser),
		count(scan.requestCount, "request"),
		count(scan.hostCount, "domain"),
	];
	say(c("dim", `  ${summary.filter(Boolean).join(" · ")}`));
	for (const [group, meta] of Object.entries(GROUPS)) {
		const items = scan.candidates.filter((x) => x.group === group);
		if (!list || !items.length) continue;
		say("");
		say(c("bold", meta.title));
		const limit = group === "unknown" && scan.mode === "device" ? 30 : Infinity;
		for (const cand of items.slice(0, limit)) {
			const mark = cand.preselected ? c("green", "[x]") : "[ ]";
			const details = [printable(cand.label), `${cand.requests} req`]
				.filter(Boolean)
				.join(" · ");
			say(
				`  ${mark} ${c("bold", String(cand.n).padStart(2))}  ${shown(cand)}  ${c("dim", details)}`,
			);
			if (cand.hosts.length > 1 || cand.hosts[0] !== cand.target)
				say(c("dim", `           hosts: ${short(cand.hosts)}`));
			for (const r of cand.reasons)
				say(c(meta.color, `           ${printable(r)}`));
		}
		if (items.length > limit)
			say(c("dim", `           … ${items.length - limit} more (see --json)`));
	}
	say("");
	if (scan.blocked.length) {
		// In NX mode a blocked domain and a nonexistent one get the same answer.
		const title = `✅ Already blocked by Pi-hole${scan.blockingMode === "NX" ? " (or nonexistent)" : ""}`;
		say(
			`${c("green", title)} (${scan.blocked.length}): ${c("dim", short(scan.blocked, 8))}`,
		);
	}
	if (scan.pathOnly.length)
		say(
			`ℹ️  Ads served from paths on required domains — not blockable via DNS (${scan.pathOnly.length}): ${c("dim", short(scan.pathOnly.map((p) => p.host)))}`,
		);
	const ignored = [
		scan.firstParty.length && `${scan.firstParty.length} first-party`,
		scan.safe.length &&
			`${scan.safe.length} safe infrastructure (${short(scan.safe, 4)})`,
	].filter(Boolean);
	if (ignored.length) say(c("dim", `⚪ Ignored: ${ignored.join(" · ")}`));
	if (scan.dead?.length)
		say(c("dim", `⚫ Not resolving (dead domains): ${short(scan.dead, 4)}`));
	if (!scan.candidates.length) say(c("green", "Nothing new to block 🎉"));
}

function requireUrl(cfg) {
	if (!cfg.piholeUrl)
		throw new Error('Run "adhunt setup" first (or set PIHOLE_URL).');
}

async function requirePassword() {
	const pw = readPassword();
	if (!pw)
		throw new Error(
			'Missing the Pi-hole app password. Run "adhunt setup" (or set PIHOLE_PASSWORD).',
		);
	return pw;
}

let transportWarned = false;

/** withPiHole(), warning once when the password would travel unencrypted. */
function session(cfg, password, fn) {
	if (!transportWarned && isInsecureRemoteUrl(cfg.piholeUrl)) {
		transportWarned = true;
		warn(
			`${cfg.piholeUrl} uses plain HTTP outside your local network: the password travels unencrypted. Use HTTPS (see "Privacy & security" in the README).`,
		);
	}
	return withPiHole(cfg, password, fn);
}

/** DNS checker that reads answers according to Pi-hole's blocking mode (see PiHole#blocking). */
function blockingChecker(cfg, blocking) {
	if (!blocking.active)
		note(
			"Pi-hole blocking is disabled right now: nothing will show as blocked",
		);
	return makeDnsChecker(cfg, blocking);
}

async function applyBlock(scan, selected, cfg, opts) {
	if (!selected.length) return say("Nothing selected.");
	requireUrl(cfg);
	const password = await requirePassword();
	const date = new Date().toLocaleDateString("sv"); // YYYY-MM-DD in local time
	const batch = {
		id: Date.now().toString(36),
		at: new Date().toISOString(),
		site: scan.site,
		items: [],
	};
	say("");
	let blocking;
	try {
		blocking = await session(cfg, password, async (ph) => {
			const group = opts.group && findGroup(await ph.groups(), opts.group);
			if (group) say(c("dim", `  group: ${group.name}`));
			for (const cand of selected) {
				const domain =
					cand.kind === "regex" ? toWildcard(cand.target) : cand.target;
				const comment = ["adhunt", scan.site, date, cand.label]
					.filter(Boolean)
					.join(" · ");
				const res = await ph.addDeny(cand.kind, domain, comment, [
					group ? group.id : 0,
				]);
				if (res.ok) {
					batch.items.push({
						kind: cand.kind,
						domain,
						target: cand.target,
						probe: cand.hosts[0],
					});
					say(`  ${c("green", "＋")} ${shown(cand)}`);
				} else {
					say(
						`  ${c("yellow", "=")} ${shown(cand)} ${c("dim", res.exists ? "(already on the list)" : res.error)}`,
					);
				}
			}
			return ph.blocking();
		});
	} finally {
		// Record what was added even when a later add fails, so `undo` removes this batch.
		if (batch.items.length) {
			const history = await loadHistory();
			history.push(batch);
			await saveHistory(history);
		}
	}
	if (!batch.items.length) return;

	// Pi-hole reloads its lists in the background: verify via DNS after a moment.
	await new Promise((r) => setTimeout(r, 2000));
	const dns = await blockingChecker(cfg, blocking);
	const states = await dns.many(batch.items.map((i) => i.probe));
	const ok = batch.items.filter(
		(i) => states.get(i.probe) === "blocked",
	).length;
	say("");
	say(
		`${c("green", `Blocked ${batch.items.length} in Pi-hole`)} · verified via DNS: ${ok}/${batch.items.length}${ok < batch.items.length ? c("dim", " (the rest may take a few seconds)") : ""}`,
	);
	say(
		c(
			"dim",
			"Undo with: adhunt undo · Devices may keep cached DNS answers until they expire.",
		),
	);
}

async function cmdScan(url, opts, cfg) {
	let password = null;
	const wait = wholeNumber(opts.wait, "--wait", { fallback: 20, max: 300 });
	if (!opts.har) {
		if (!url)
			throw new Error("Missing the URL. Example: adhunt https://example.com");
		url = pageUrl(url);
		requireUrl(cfg);
		password = await requirePassword();
	} else if (cfg.piholeUrl) {
		password = readPassword();
	}
	note("loading EasyList/EasyPrivacy + TrackerDB…");
	const engines = await loadEngines(CACHE_DIR, { log: warn });
	const cap = opts.har
		? await fromHar(opts.har)
		: await capture(url, {
				mobile: opts.mobile,
				wait,
				click: opts.click,
				headed: opts.headed,
				log: note,
			});
	if (!cap.requests.length)
		throw new Error("No requests were captured (did the page load?).");
	const result = analyze(cap, engines);
	let dnsStatus = new Map();
	let blocking;
	if (password) {
		note("classifying and querying Pi-hole's DNS…");
		blocking = await session(cfg, password, (ph) => ph.blocking());
		const dns = await blockingChecker(cfg, blocking);
		dnsStatus = await dns.many(result.candidates.flatMap((x) => x.hosts));
	} else {
		note("no Pi-hole URL or password: skipping the already-blocked check");
	}
	const scan = {
		mode: opts.har ? "har" : "scan",
		at: new Date().toISOString(),
		blockingMode: blocking?.mode,
		...finalize(result, dnsStatus),
	};
	await saveLastScan(scan);
	await review(scan, opts, cfg);
}

/** Typed selection, for terminals that can't draw the menu (TERM=dumb, screen readers). */
async function askTyped(scan, rec) {
	for (;;) {
		const ans = await prompt(
			`\nBlock which? ${c("dim", `[r = recommended (${rec.map((x) => x.n).join(" ") || "—"}) · numbers: 1 3 5-7 · r 9 · Enter = nothing]`)} `,
		);
		try {
			return parseSelection([ans], scan);
		} catch (e) {
			say(c("yellow", e.message));
		}
	}
}

async function review(scan, opts, cfg) {
	if (opts.json) return say(JSON.stringify(scan, null, 2));
	const interactive =
		process.stdin.isTTY && tty && !opts.yes && Boolean(cfg.piholeUrl);
	const menu = interactive && !opts["no-menu"] && process.env.TERM !== "dumb";
	printReport(scan, { list: !menu });
	if (!scan.candidates.length) return;
	const rec = scan.candidates.filter((x) => x.preselected);
	if (opts.yes) return applyBlock(scan, rec, cfg, opts);
	if (!cfg.piholeUrl)
		return say(
			c(
				"dim",
				'\nTo block any of these, run "adhunt setup" first (or set PIHOLE_URL).',
			),
		);
	if (!interactive) {
		return say(
			c(
				"dim",
				`\nTo block: adhunt block r   (recommended: ${rec.map((x) => x.n).join(" ") || "none"}) · or by number: adhunt block 1 4 7`,
			),
		);
	}
	if (menu) say("");
	const selected = menu
		? await selectCandidates(scan, { style: c })
		: await askTyped(scan, rec);
	await applyBlock(scan, selected, cfg, opts);
}

async function cmdBlock(tokens, opts, cfg) {
	const scan = await loadLastScan();
	if (!scan) throw new Error("No previous scan. Run this first: adhunt <url>");
	if (!tokens.length)
		throw new Error(
			"Say what to block: adhunt block r   or   adhunt block 1 3 5-7",
		);
	const selected = parseSelection(tokens, scan);
	say(
		c("dim", `Last scan: ${scan.site} (${new Date(scan.at).toLocaleString()})`),
	);
	await applyBlock(scan, selected, cfg, opts);
}

async function cmdUndo(cfg) {
	const history = await loadHistory();
	const batch = history.pop();
	if (!batch) return say("No adhunt blocks to undo.");
	requireUrl(cfg);
	await session(cfg, await requirePassword(), async (ph) => {
		for (const item of batch.items) {
			const removed = await ph.removeDeny(item.kind, item.domain);
			say(
				`  ${removed ? c("red", "－") : c("dim", "·")} ${item.target}${item.kind === "regex" ? c("dim", " (+subdomains)") : ""}${removed ? "" : c("dim", " (was already gone)")}`,
			);
		}
	});
	await saveHistory(history);
	say(
		c(
			"green",
			`Undid the block from ${batch.site} (${new Date(batch.at).toLocaleString()}).`,
		),
	);
}

async function cmdList(cfg) {
	requireUrl(cfg);
	const entries = await session(cfg, await requirePassword(), (ph) =>
		ph.listDeny(),
	);
	const mine = entries.filter((e) => e.comment?.startsWith("adhunt"));
	if (!mine.length) return say("adhunt hasn't added anything to Pi-hole yet.");
	for (const e of mine.sort((a, b) => a.date_added - b.date_added)) {
		const target =
			e.kind === "regex"
				? `${printable(fromWildcard(e.domain) || e.domain)} ${c("dim", "(+subdomains)")}`
				: printable(e.domain);
		say(
			`  ${e.enabled ? c("green", "●") : c("dim", "○")} ${target}  ${c("dim", printable(e.comment.replace(/^adhunt · /, "")))}`,
		);
	}
	say(
		c(
			"dim",
			`\n${count(mine.length, "entry", "entries")} · remove one with: adhunt remove <domain>`,
		),
	);
}

async function cmdRemove(target, cfg) {
	if (!target) throw new Error("Usage: adhunt remove <domain>");
	requireUrl(cfg);
	const removed = await session(cfg, await requirePassword(), async (ph) => {
		const entries = (await ph.listDeny()).filter((e) =>
			e.comment?.startsWith("adhunt"),
		);
		const hit = entries.find(
			(e) => e.domain === target || fromWildcard(e.domain) === target,
		);
		if (!hit) return null;
		await ph.removeDeny(hit.kind, hit.domain);
		return hit;
	});
	if (!removed)
		throw new Error(
			`"${target}" is not among the entries adhunt added (see: adhunt list).`,
		);
	const history = await loadHistory();
	for (const b of history)
		b.items = b.items.filter((i) => i.domain !== removed.domain);
	await saveHistory(history.filter((b) => b.items.length));
	say(`${c("red", "－")} ${target} removed from Pi-hole.`);
}

async function cmdClients(cfg) {
	requireUrl(cfg);
	const clients = await session(cfg, await requirePassword(), (ph) =>
		ph.topClients(20),
	);
	say(c("bold", "Devices with the most queries (since Pi-hole last started):"));
	for (const cl of clients)
		say(
			`  ${printable(cl.ip).padEnd(16)} ${String(cl.count).padStart(7)}  ${c("dim", printable(cl.name))}`,
		);
	say(
		c(
			"dim",
			"\nNext: adhunt device <ip> --minutes 10   (use the app/site with ads on that device right before)",
		),
	);
}

async function cmdDevice(ip, opts, cfg) {
	if (!ip || !isIP(ip))
		throw new Error(
			"Usage: adhunt device <ip> [--minutes 15]   (list IPs with: adhunt clients)",
		);
	const minutes = wholeNumber(opts.minutes, "--minutes", {
		fallback: 15,
		max: 1440,
	});
	requireUrl(cfg);
	const until = Math.floor(Date.now() / 1000);
	const [queries, blocking] = await session(
		cfg,
		await requirePassword(),
		(ph) =>
			Promise.all([
				ph.queries({ clientIp: ip, from: until - minutes * 60, until }),
				ph.blocking(),
			]),
	);
	const counts = new Map();
	let alreadyBlocked = 0;
	for (const q of queries) {
		if (isBlockedStatus(q.status)) {
			alreadyBlocked++;
			continue;
		}
		const d = q.domain?.toLowerCase();
		// Local names (and Tailscale MagicDNS) never reach the internet: nothing to block.
		if (!d?.includes(".") || LOCAL_NAMES.test(d)) continue;
		counts.set(d, (counts.get(d) || 0) + 1);
	}
	note(
		`${queries.length} queries in ${minutes} min · ${alreadyBlocked} already blocked · ${counts.size} allowed domains`,
	);
	if (!counts.size) return say("No allowed queries in that time range.");
	note("loading EasyList/EasyPrivacy + TrackerDB…");
	const engines = await loadEngines(CACHE_DIR, { log: warn });
	// No real URL: probe the domain as a script/image/xhr/iframe loaded by a third-party site.
	const requests = [...counts].map(([d, n]) => ({
		url: `https://${d}/`,
		types: ["script", "image", "xhr", "sub_frame"],
		sourceUrl: "https://adhunt.invalid/",
		weight: n,
	}));
	const result = analyze({ requests, requestedUrl: "", finalUrl: "" }, engines);
	result.site = `device ${ip}`;
	result.finalUrl = `device ${ip} · last ${minutes} min`;
	const dns = await blockingChecker(cfg, blocking);
	const scan = {
		mode: "device",
		at: new Date().toISOString(),
		blockingMode: blocking.mode,
		...finalize(
			result,
			await dns.many(result.candidates.flatMap((x) => x.hosts)),
		),
	};
	await saveLastScan(scan);
	await review(scan, opts, cfg);
}

async function cmdSetup(cfg) {
	const current = cfg.piholeUrl || "http://pi.hole";
	cfg.piholeUrl = piholeUrl(
		(await prompt(`Pi-hole URL [${current}]: `)).trim() || current,
	);

	let password = process.env.PIHOLE_PASSWORD;
	const stored = password ? null : storedPassword();
	if (password) {
		note("using PIHOLE_PASSWORD (nothing is stored)");
	} else {
		say(
			"Pi-hole app password (Settings → Web interface / API → Advanced settings → Configure app password).",
		);
		password =
			(await prompt(
				stored ? "Password (Enter keeps the stored one): " : "Password: ",
				{ hidden: true },
			)) || stored;
		if (!password) throw new Error("No password entered.");
	}
	// Log in before saving anything, so a wrong URL or password is never stored.
	const [denied, blocking] = await session(cfg, password, (ph) =>
		Promise.all([ph.listDeny(), ph.blocking()]),
	);
	// Environment overrides (PIHOLE_DNS) stay out of the saved file.
	const file = await saveConfig({
		...(await readConfigFile()),
		piholeUrl: cfg.piholeUrl,
	});
	say(c("dim", `Config saved to ${file}`));
	if (!process.env.PIHOLE_PASSWORD && password !== stored) {
		try {
			savePassword(password);
			say(
				c(
					"dim",
					`Password stored in the ${keychainName} as "adhunt-pihole", never in a file.`,
				),
			);
		} catch (e) {
			warn(e.message);
		}
	}
	const dns = await blockingChecker(cfg, blocking);
	say(
		c(
			"green",
			`✓ Connected to Pi-hole (${count(denied.length, "domain")} on the deny list, blocking mode ${blocking.mode}) · DNS ${dns.server}: doubleclick.net → ${await dns("doubleclick.net")}`,
		),
	);
}

function cmdLogout() {
	say(
		forgetPassword()
			? `Removed the Pi-hole password from the ${keychainName}.`
			: `No Pi-hole password is stored in the ${keychainName}.`,
	);
	if (process.env.PIHOLE_PASSWORD)
		note("PIHOLE_PASSWORD is still set in this shell");
}

async function main() {
	const { values: opts, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			mobile: { type: "boolean", short: "m" },
			wait: { type: "string", short: "w" },
			click: { type: "boolean" },
			headed: { type: "boolean" },
			har: { type: "string" },
			yes: { type: "boolean", short: "y" },
			json: { type: "boolean" },
			minutes: { type: "string" },
			group: { type: "string", short: "g" },
			"no-menu": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [cmd, ...args] = positionals;
	if (opts.help || (!cmd && !opts.har)) return say(HELP);
	const cfg = await loadConfig();
	switch (cmd) {
		case "scan":
			return cmdScan(args[0], opts, cfg);
		case "block":
			return cmdBlock(args, opts, cfg);
		case "undo":
			return cmdUndo(cfg);
		case "list":
			return cmdList(cfg);
		case "remove":
			return cmdRemove(args[0], cfg);
		case "device":
			return cmdDevice(args[0], opts, cfg);
		case "clients":
			return cmdClients(cfg);
		case "setup":
			return cmdSetup(cfg);
		case "logout":
			return cmdLogout();
		default:
			return cmdScan(cmd, opts, cfg);
	}
}

main().then(
	() => exitWhenFlushed(0),
	(e) => {
		console.error(
			c("red", `✗ ${printable(e.message, { keepNewlines: true })}`),
		);
		exitWhenFlushed(1);
	},
);
