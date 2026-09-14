import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
	dnsAnswerStatus,
	findGroup,
	isInsecureRemoteUrl,
	PiHole,
} from "../src/pihole.js";

/** Runs fn against a local HTTP server that answers every request with handler(req, res). */
async function withServer(handler, fn) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		return await fn(`http://127.0.0.1:${server.address().port}`);
	} finally {
		server.close();
	}
}

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

test("login: Pi-hole v5 (no /api/auth) asks for v6", async () => {
	const html = (status) => (_req, res) => {
		res.writeHead(status, { "content-type": "text/html" });
		res.end("<html>Pi-hole admin</html>");
	};
	for (const status of [404, 200]) {
		await withServer(html(status), (url) =>
			assert.rejects(
				new PiHole({ url, password: "x" }).login(),
				/v6 or newer is required/,
			),
		);
	}
});

test("login: v6 session and wrong password", async () => {
	await withServer(
		(req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const ok = JSON.parse(body).password === "right";
				res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
				res.end(
					JSON.stringify({ session: { valid: ok, sid: ok ? "sid123" : null } }),
				);
			});
		},
		async (url) => {
			const ph = new PiHole({ url, password: "right" });
			await ph.login();
			assert.equal(ph.sid, "sid123");
			await assert.rejects(
				new PiHole({ url, password: "wrong" }).login(),
				/rejected the password/,
			);
		},
	);
});

test("plain HTTP is only flagged outside the local network", () => {
	for (const url of [
		"http://pi.hole",
		"http://localhost:8080",
		"http://127.0.0.1",
		"http://192.168.1.2/admin",
		"http://10.0.0.5",
		"http://172.20.1.1",
		"http://100.100.1.1",
		"http://[::1]",
		"http://[fd12:3456::1]",
		"http://pihole",
		"http://pihole.local",
		"http://pihole.home.arpa",
		"http://pihole.example.ts.net",
		"https://pihole.example.com",
		"https://203.0.113.10",
	])
		assert.equal(isInsecureRemoteUrl(url), false, url);
	for (const url of [
		"http://pihole.example.com",
		"http://203.0.113.10",
		"http://172.32.0.1",
		"http://100.128.0.1",
		"http://[2001:db8::1]",
	])
		assert.equal(isInsecureRemoteUrl(url), true, url);
});

test("groups are found by name or id", () => {
	const groups = [
		{ id: 0, name: "Default" },
		{ id: 3, name: "Kids" },
	];
	assert.equal(findGroup(groups, "kids").id, 3);
	assert.equal(findGroup(groups, "0").name, "Default");
	assert.throws(
		() => findGroup(groups, "guests"),
		/no group "guests" \(groups: Default, Kids\)/,
	);
});
