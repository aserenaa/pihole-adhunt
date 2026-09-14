import assert from "node:assert/strict";
import { test } from "node:test";

import { dnsAnswerStatus } from "../src/pihole.js";

const PIHOLE = "192.0.2.53";
const answer = (...addresses) => ({ addresses });
const error = (code) => ({ code });

test("NULL mode: 0.0.0.0 means blocked", () => {
	const mode = { mode: "NULL" };
	assert.equal(dnsAnswerStatus(answer("0.0.0.0"), mode, PIHOLE), "blocked");
	assert.equal(dnsAnswerStatus(answer("203.0.113.7"), mode, PIHOLE), "ok");
	assert.equal(dnsAnswerStatus(error("ENOTFOUND"), mode, PIHOLE), "nx");
	assert.equal(dnsAnswerStatus(error("ENODATA"), mode, PIHOLE), "ok");
});

test("IP modes: Pi-hole's own IP, or the forced IPv4, means blocked", () => {
	for (const name of ["IP", "IP_NODATA_AAAA"]) {
		const own = { mode: name, ipv4: "" };
		assert.equal(dnsAnswerStatus(answer(PIHOLE), own, PIHOLE), "blocked");
		assert.equal(dnsAnswerStatus(answer("203.0.113.7"), own, PIHOLE), "ok");
		const forced = { mode: name, ipv4: "192.0.2.99" };
		assert.equal(
			dnsAnswerStatus(answer("192.0.2.99"), forced, PIHOLE),
			"blocked",
		);
		assert.equal(dnsAnswerStatus(answer(PIHOLE), forced, PIHOLE), "ok");
	}
});

test("NX mode: NXDOMAIN means blocked", () => {
	const mode = { mode: "NX" };
	assert.equal(dnsAnswerStatus(error("ENOTFOUND"), mode, PIHOLE), "blocked");
	assert.equal(dnsAnswerStatus(answer("203.0.113.7"), mode, PIHOLE), "ok");
});

test("NODATA mode: an empty answer means blocked", () => {
	const mode = { mode: "NODATA" };
	assert.equal(dnsAnswerStatus(error("ENODATA"), mode, PIHOLE), "blocked");
	assert.equal(dnsAnswerStatus(error("ENOTFOUND"), mode, PIHOLE), "nx");
});

test("0.0.0.0 counts as blocked in any mode; resolver failures are errors", () => {
	assert.equal(
		dnsAnswerStatus(answer("0.0.0.0"), { mode: "IP" }, PIHOLE),
		"blocked",
	);
	assert.equal(
		dnsAnswerStatus(error("ETIMEOUT"), { mode: "NULL" }, PIHOLE),
		"error",
	);
	assert.equal(dnsAnswerStatus(answer("0.0.0.0")), "blocked");
});
