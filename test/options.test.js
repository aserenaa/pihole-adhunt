import assert from "node:assert/strict";
import { test } from "node:test";

import {
	pageUrl,
	parseSelection,
	piholeUrl,
	wholeNumber,
} from "../src/options.js";

const scan = {
	candidates: [
		{ n: 1, target: "ads.example", preselected: true },
		{ n: 2, target: "tracker.example", preselected: true },
		{ n: 3, target: "cdn.example", preselected: false },
		{ n: 4, target: "bidder.example", preselected: false },
	],
};
const picked = (...tokens) => parseSelection(tokens, scan).map((c) => c.n);

test("selection: recommended, numbers, ranges and nothing", () => {
	assert.deepEqual(picked("r"), [1, 2]);
	assert.deepEqual(picked("recommended"), [1, 2]);
	assert.deepEqual(picked("y 4"), [1, 2, 4]);
	assert.deepEqual(picked("3-4"), [3, 4]);
	assert.deepEqual(picked("1,3", "3"), [1, 3]);
	assert.deepEqual(picked(""), []);
	assert.deepEqual(picked("n"), []);
	assert.deepEqual(picked("none"), []);
});

test("selection: unknown tokens and numbers are rejected", () => {
	assert.throws(() => picked("s"), /Didn't understand "s"/);
	assert.throws(() => picked("5"), /no number 5/);
	assert.throws(() => picked("4-3"), /backwards range/);
});

test("whole-number options", () => {
	assert.equal(
		wholeNumber(undefined, "--wait", { fallback: 20, max: 300 }),
		20,
	);
	assert.equal(wholeNumber("45", "--wait", { fallback: 20, max: 300 }), 45);
	for (const bad of ["0", "-5", "2.5", "abc", "", "301", "1e2"])
		assert.throws(
			() => wholeNumber(bad, "--wait", { fallback: 20, max: 300 }),
			/--wait must be a whole number from 1 to 300/,
			bad,
		);
});

test("page URLs: https by default, only http(s)", () => {
	assert.equal(pageUrl("example.com"), "https://example.com/");
	assert.equal(
		pageUrl("http://localhost:8080/a?b=1"),
		"http://localhost:8080/a?b=1",
	);
	assert.equal(pageUrl("localhost:8080"), "https://localhost:8080/");
	assert.throws(() => pageUrl("file:///etc/hosts"), /Only http\(s\) pages/);
	assert.throws(() => pageUrl("ftp://example.com"), /Only http\(s\) pages/);
	for (const bad of [
		"javascript:alert(1)",
		"data:text/html,hi",
		"exa mple.com",
	])
		assert.throws(() => pageUrl(bad), /not a valid URL/, bad);
});

test("Pi-hole URLs: scheme added, /admin and trailing slashes dropped, prefixes kept", () => {
	assert.equal(piholeUrl("pi.hole"), "http://pi.hole");
	assert.equal(piholeUrl("http://192.0.2.53/"), "http://192.0.2.53");
	assert.equal(piholeUrl("http://192.0.2.53/admin/"), "http://192.0.2.53");
	assert.equal(
		piholeUrl("https://pi.hole:8443/admin/index.lp"),
		"https://pi.hole:8443",
	);
	assert.equal(
		piholeUrl("https://home.example/pihole/admin"),
		"https://home.example/pihole",
	);
	assert.throws(() => piholeUrl("ftp://pi.hole"), /must use http/);
	assert.throws(() => piholeUrl("http://exa mple"), /not a valid Pi-hole URL/);
});
