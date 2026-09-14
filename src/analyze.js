import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { dirname, join } from "node:path";

import { FiltersEngine, Request } from "@ghostery/adblocker";
import loadTrackerDB from "@ghostery/trackerdb";
import { getDomain, getHostname } from "tldts";

import { isProtected, isSafe, RISKY_TARGETS } from "./safe.js";

const ENGINE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
// TrackerDB categories that can be blocked without breaking sites.
const BLOCK_CATEGORIES = new Set([
	"advertising",
	"pornvertising",
	"site_analytics",
]);
const AD_CATEGORIES = new Set(["advertising", "pornvertising"]);
const GROUP_ORDER = { block: 0, review: 1, unknown: 2 };

/** EasyList+EasyPrivacy+uBO engine (Ghostery's prebuilt build, cached for 3 days) and TrackerDB. */
export async function loadEngines(cacheDir) {
	await mkdir(cacheDir, { recursive: true });
	const path = join(cacheDir, `ghostery-ads-tracking.bin`);
	const age = await stat(path).then(
		(s) => Date.now() - s.mtimeMs,
		() => Infinity,
	);
	if (age > ENGINE_MAX_AGE_MS) await unlink(path).catch(() => {});
	const engine = await FiltersEngine.fromPrebuiltAdsAndTracking(fetch, {
		path,
		read: readFile,
		write: writeFile,
	});
	const require = createRequire(import.meta.url);
	const tdbFile = join(
		dirname(require.resolve("@ghostery/trackerdb")),
		"..",
		"trackerdb.engine",
	);
	const tdb = await loadTrackerDB(await readFile(tdbFile));
	return { engine, tdb };
}

/**
 * If the rule blocks a whole domain (`||domain^`, no path and no `$domain=`), returns that
 * domain: it is exactly equivalent to a Pi-hole wildcard. Rules with a path (`||site.com/ads/`)
 * can't be translated to DNS without blocking the whole site → null.
 */
export function hostLevelTarget(filter) {
	if (
		!filter?.isHostnameAnchor() ||
		filter.hasFilter() ||
		filter.isRegex() ||
		filter.hasDomains()
	)
		return null;
	if (
		filter.denyallow ||
		filter.isRedirect() ||
		filter.isCSP() ||
		filter.isReplace() ||
		filter.isRemoveParam()
	)
		return null;
	const host = filter.getHostname();
	return host?.includes(".") ? host : null;
}

function trackerInfo(tdb, host) {
	const m = tdb.matchDomain(host)?.[0];
	return m
		? {
				name: m.pattern?.name || "",
				org: m.organization?.name || "",
				category: m.category?.key || "",
			}
		: null;
}

/** Every blocking rule that applies (none if an exception wins) → NetworkFilter[]. */
function matchRequest(engine, url, types, sourceUrl) {
	for (const type of types) {
		let req;
		let res;
		try {
			req = Request.fromRawDetails({ url, type, sourceUrl });
			res = engine.match(req);
		} catch {
			continue;
		}
		if (!res.match || !res.filter) continue;
		// match() only returns the winning rule (often a uBO $redirect); to find out whether a
		// full-domain rule exists we have to look at all of them.
		const all = [...engine.matchAll(req)].filter(
			(f) =>
				!f.isException() &&
				!f.isCSP() &&
				!f.isGenericHide() &&
				!f.isSpecificHide(),
		);
		return all.length ? all : [res.filter];
	}
	return [];
}

/**
 * Groups requests by host and decides what to propose.
 * capture: output of capture()/fromHar(), or a synthetic { requests } (device mode, with `types` and `weight`).
 */
export function analyze(capture, { engine, tdb }) {
	const siteDomains = new Set(
		[
			getDomain(capture.requestedUrl || ""),
			getDomain(capture.finalUrl || ""),
		].filter(Boolean),
	);
	const site =
		getHostname(capture.finalUrl || capture.requestedUrl || "") || "device";
	const hosts = new Map();
	const hostOf = (h) => {
		if (!hosts.has(h))
			hosts.set(h, {
				host: h,
				domain: getDomain(h) || h,
				count: 0,
				types: {},
				matched: 0,
				targets: new Map(),
				pathFilters: new Set(),
				initiators: new Set(),
				popup: false,
			});
		return hosts.get(h);
	};

	for (const r of capture.requests) {
		if (!/^(https?|wss?):/.test(r.url)) continue;
		const host = getHostname(r.url);
		// Pi-hole blocks names: IP addresses and single-label hosts can't be blocked via DNS.
		if (!host?.includes(".") || isIP(host)) continue;
		const h = hostOf(host);
		const weight = r.weight || 1;
		h.count += weight;
		const types = r.types || [r.type || "other"];
		h.types[types[0]] = (h.types[types[0]] || 0) + weight;
		if (r.popup) h.popup = true;
		for (const u of [r.initiatorUrl, r.type !== "main_frame" && r.sourceUrl]) {
			const ih = u && getHostname(u);
			if (ih && ih !== host) h.initiators.add(ih);
		}
		if (r.type === "main_frame" && !r.popup) continue;
		const filters = matchRequest(
			engine,
			r.url,
			types,
			r.sourceUrl || capture.finalUrl || "https://adhunt.invalid/",
		);
		if (!filters.length) continue;
		h.matched += weight;
		let hostLevel = false;
		for (const f of filters) {
			const target = hostLevelTarget(f);
			if (!target) continue;
			hostLevel = true;
			if (!h.targets.has(target)) h.targets.set(target, f.toString());
		}
		if (!hostLevel) h.pathFilters.add(filters[0].toString());
	}
	for (const u of [...(capture.popups || []), ...(capture.redirects || [])]) {
		const host = getHostname(u);
		if (host?.includes(".") && !isIP(host) && !siteDomains.has(getDomain(host)))
			hostOf(host).popup = true;
	}

	// ── Step 1: per-host decision ────────────────────────────────────────────────
	const adHosts = new Set();
	for (const h of hosts.values()) {
		h.info = trackerInfo(tdb, h.host);
		const label = h.info
			? [h.info.name, h.info.category].filter(Boolean).join(" · ")
			: "";
		const firstParty = siteDomains.has(h.domain);
		// The broadest target that is still safe (e.g. g.doubleclick.net over securepubads.g.doubleclick.net).
		const target = [...h.targets.keys()]
			.filter((t) => !isProtected(t) && !siteDomains.has(t))
			.sort((a, b) => a.length - b.length)[0];

		if (target) {
			const riskyCategory = h.info && !BLOCK_CATEGORIES.has(h.info.category);
			const risky =
				RISKY_TARGETS.has(target) || RISKY_TARGETS.has(h.host) || riskyCategory;
			h.decision = {
				key: target,
				kind: "regex",
				group: risky ? "review" : "block",
				preselected: !risky,
				label,
				reason:
					`rule ${h.targets.get(target)}` +
					(risky
						? ` · ⚠ may break site features${riskyCategory ? ` (${h.info.category})` : ""}`
						: ""),
			};
			if (!risky) adHosts.add(h.host);
		} else if (isSafe(h.host)) {
			h.decision = { group: "safe" };
		} else if (firstParty) {
			h.decision = { group: h.matched ? "pathOnly" : "firstParty" };
		} else if (h.matched && h.matched === h.count) {
			h.decision = {
				key: h.host,
				kind: "exact",
				group: "review",
				label,
				reason: `every request matched path rules (${[...h.pathFilters][0]})`,
			};
			adHosts.add(h.host);
		} else if (h.matched) {
			h.decision = { group: "pathOnly" };
		} else if (h.popup) {
			h.decision = {
				key: h.host,
				kind: "exact",
				group: "review",
				label,
				reason: "opened a pop-up or redirected the page",
			};
			adHosts.add(h.host);
		} else if (h.info && AD_CATEGORIES.has(h.info.category)) {
			h.decision = {
				key: h.host,
				kind: "exact",
				group: "review",
				label,
				reason: `TrackerDB classifies it as ${h.info.category}, but no filter rule matches`,
			};
		} else {
			h.decision = { key: h.host, kind: "exact", group: "unknown", label };
		}
	}

	// ── Step 2: unknown hosts loaded by an ad (auction chains, redirects) ──────────
	for (let changed = true; changed; ) {
		changed = false;
		for (const h of hosts.values()) {
			if (h.decision.group !== "unknown") continue;
			const parent = [...h.initiators].find((i) => adHosts.has(i));
			if (!parent) continue;
			h.decision = {
				...h.decision,
				group: "review",
				reason: `loaded by ${parent} (ad)`,
			};
			adHosts.add(h.host);
			changed = true;
		}
	}

	// ── Candidates grouped by what would be blocked in Pi-hole ──────────────────
	const candidates = new Map();
	for (const h of hosts.values()) {
		const d = h.decision;
		if (!d.key) continue;
		let c = candidates.get(d.key);
		if (!c) {
			c = {
				target: d.key,
				kind: d.kind,
				group: d.group,
				preselected: !!d.preselected,
				label: d.label || "",
				reasons: [],
				hosts: [],
				requests: 0,
			};
			candidates.set(d.key, c);
		} else {
			// If any host in the group is risky, the whole group drops to "review".
			if (GROUP_ORDER[d.group] > GROUP_ORDER[c.group]) c.group = d.group;
			c.preselected = c.preselected && !!d.preselected;
		}
		if (d.reason && !c.reasons.includes(d.reason)) c.reasons.push(d.reason);
		if (!c.label && d.label) c.label = d.label;
		c.hosts.push(h.host);
		c.requests += h.count;
	}

	const list = (group) =>
		[...hosts.values()]
			.filter((h) => h.decision.group === group)
			.map((h) => h.host)
			.sort();
	return {
		site,
		requestedUrl: capture.requestedUrl || "",
		finalUrl: capture.finalUrl || "",
		title: capture.title || "",
		browser: capture.browser || "",
		requestCount: capture.requests.reduce((n, r) => n + (r.weight || 1), 0),
		hostCount: hosts.size,
		candidates: [...candidates.values()],
		safe: list("safe"),
		firstParty: list("firstParty"),
		pathOnly: [...hosts.values()]
			.filter((h) => h.decision.group === "pathOnly")
			.map((h) => ({ host: h.host, filter: [...h.pathFilters][0] })),
	};
}

/**
 * Uses Pi-hole's DNS answers to drop what is already blocked, then sorts and numbers.
 * dnsStatus: Map host → 'blocked' | 'ok' | 'nx' | 'error'.
 */
export function finalize(result, dnsStatus) {
	const blocked = [];
	const dead = [];
	const open = [];
	for (const c of result.candidates) {
		const states = c.hosts.map((h) => dnsStatus.get(h));
		const live = c.hosts.filter(
			(_, i) => states[i] !== "blocked" && states[i] !== "nx",
		);
		if (live.length) open.push({ ...c, hosts: live });
		else if (states.includes("blocked"))
			blocked.push(...c.hosts.filter((h) => dnsStatus.get(h) === "blocked"));
		else dead.push(...c.hosts);
	}
	open.sort(
		(a, b) =>
			GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
			b.requests - a.requests ||
			a.target.localeCompare(b.target),
	);
	open.forEach((c, i) => {
		c.n = i + 1;
	});
	return {
		...result,
		candidates: open,
		blocked: blocked.sort(),
		dead: dead.sort(),
	};
}
