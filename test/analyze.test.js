import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { NetworkFilter } from "@ghostery/adblocker";

import {
	analyze,
	finalize,
	hostLevelTarget,
	loadEngines,
} from "../src/analyze.js";
import { desktopUserAgent, fromHar } from "../src/capture.js";
import { fromWildcard, toWildcard } from "../src/pihole.js";
import { isProtected, isSafe } from "../src/safe.js";

let engines;
let result;
const cand = (target) => result.candidates.find((c) => c.target === target);

before(async () => {
	engines = await loadEngines(
		process.env.ADHUNT_TEST_CACHE || join(tmpdir(), "adhunt-test-cache"),
	);
	result = analyze(
		await fromHar(
			fileURLToPath(new URL("./fixtures/news.har", import.meta.url)),
		),
		engines,
	);
});

test("full-domain rules → preselected wildcard", () => {
	for (const t of [
		"taboola.com",
		"doubleclick.net",
		"amazon-adsystem.com",
		"adnxs.com",
		"google-analytics.com",
	]) {
		assert.equal(cand(t)?.group, "block", t);
		assert.equal(cand(t).kind, "regex");
		assert.equal(cand(t).preselected, true, t);
	}
	assert.deepEqual(cand("taboola.com").hosts.sort(), [
		"cdn.taboola.com",
		"trc.taboola.com",
	]);
});

test("Tag Manager and Facebook SDK → review, never preselected", () => {
	assert.equal(cand("googletagmanager.com").group, "review");
	assert.equal(cand("googletagmanager.com").preselected, false);
	assert.equal(cand("connect.facebook.net").group, "review");
});

test("unknown host loaded by an ad → review, with the reason", () => {
	const c = cand("rtb.weirdbidder-xyz.com");
	assert.equal(c.group, "review");
	assert.match(c.reasons[0], /doubleclick\.net/);
});

test("first party, infrastructure and unknown hosts", () => {
	assert.ok(
		result.pathOnly.some((p) => p.host === "www.example-news.com"),
		"path rule on the first-party domain",
	);
	assert.ok(result.firstParty.includes("static.example-news.com"));
	assert.ok(result.safe.includes("cdnjs.cloudflare.com"));
	assert.ok(result.safe.includes("www.youtube.com"));
	assert.equal(cand("img.somecdn-unknown.net").group, "unknown");
	assert.equal(cand("example-news.com"), undefined);
});

test("finalize drops blocked/dead hosts and numbers by group", () => {
	const dns = new Map([
		["cdn.taboola.com", "blocked"],
		["trc.taboola.com", "blocked"],
		["img.somecdn-unknown.net", "nx"],
	]);
	const f = finalize(result, dns);
	assert.ok(!f.candidates.some((c) => c.target === "taboola.com"));
	assert.deepEqual(f.blocked, ["cdn.taboola.com", "trc.taboola.com"]);
	assert.deepEqual(f.dead, ["img.somecdn-unknown.net"]);
	assert.deepEqual(
		f.candidates.map((c) => c.n),
		f.candidates.map((_, i) => i + 1),
	);
	const order = f.candidates.map((c) => c.group);
	assert.deepEqual(
		order,
		[...order].sort(
			(a, b) =>
				["block", "review", "unknown"].indexOf(a) -
				["block", "review", "unknown"].indexOf(b),
		),
	);
});

test("only rules without a path or $domain= translate to DNS", () => {
	assert.equal(
		hostLevelTarget(NetworkFilter.parse("||criteo.com^$3p")),
		"criteo.com",
	);
	assert.equal(
		hostLevelTarget(NetworkFilter.parse("||example.com/ads/")),
		null,
	);
	assert.equal(
		hostLevelTarget(NetworkFilter.parse("||ads.example.com^$domain=foo.com")),
		null,
	);
	assert.equal(hostLevelTarget(NetworkFilter.parse("/banner/*/img^")), null);
});

test("device mode: a domain without a URL is probed with several types", () => {
	const r = analyze(
		{
			requests: [
				{
					url: "https://ads.pubmatic.com/",
					types: ["script", "image", "xhr", "sub_frame"],
					sourceUrl: "https://adhunt.invalid/",
					weight: 7,
				},
			],
		},
		engines,
	);
	assert.equal(r.candidates[0]?.group, "block");
	assert.equal(r.candidates[0].requests, 7);
});

test("helpers", () => {
	assert.equal(fromWildcard(toWildcard("a-b.c.net")), "a-b.c.net");
	assert.ok(isSafe("fonts.gstatic.com") && !isSafe("gstatic.com.evil.net"));
});

test("Google country domains are protected, their ad subdomains are not", () => {
	assert.ok(isProtected("google.co.uk") && isSafe("www.google.de"));
	assert.ok(!isProtected("adservice.google.co.uk"));
	assert.ok(!isSafe("google.com.evil.net") && !isSafe("notgoogle.com"));
});

test("desktop user agent follows the host OS and browser", () => {
	const mac = desktopUserAgent("140.0.7339.81", "chrome", "darwin");
	assert.match(mac, /\(Macintosh; Intel Mac OS X 10_15_7\)/);
	assert.match(mac, /Chrome\/140\.0\.0\.0 Safari\/537\.36$/);
	const win = desktopUserAgent("140.0.3485.54", "msedge", "win32");
	assert.match(win, /\(Windows NT 10\.0; Win64; x64\)/);
	assert.match(win, / Edg\/140\.0\.0\.0$/);
	assert.match(
		desktopUserAgent("139.0.1", undefined, "linux"),
		/\(X11; Linux x86_64\)/,
	);
	assert.doesNotMatch(desktopUserAgent("140.0.1", "chrome"), /Headless/);
});

test("IP addresses are never proposed: Pi-hole only blocks names", () => {
	const r = analyze(
		{
			requestedUrl: "https://news.example.com/",
			finalUrl: "https://news.example.com/",
			requests: [
				{ url: "https://203.0.113.5/tag/js/gpt.js", type: "script" },
				{ url: "https://[2001:db8::1]/ads.js", type: "script" },
			],
			popups: ["http://198.51.100.7/landing"],
		},
		engines,
	);
	assert.deepEqual(r.candidates, []);
	assert.equal(r.hostCount, 0);
});
