import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
	dnsAnswerStatus,
	findGroup,
	isBlockedStatus,
	isInsecureRemoteUrl,
	PiHole,
	parseDnsServer,
	withPiHole,
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

test("DNS server with an optional port (e.g. Docker mapping 1053:53)", () => {
	assert.deepEqual(parseDnsServer("192.0.2.53"), {
		host: "192.0.2.53",
		port: 53,
	});
	assert.deepEqual(parseDnsServer("192.0.2.53:1053"), {
		host: "192.0.2.53",
		port: 1053,
	});
	assert.deepEqual(parseDnsServer("pi.hole:1053"), {
		host: "pi.hole",
		port: 1053,
	});
	assert.deepEqual(parseDnsServer("[2001:db8::53]:1053"), {
		host: "2001:db8::53",
		port: 1053,
	});
	assert.deepEqual(parseDnsServer("[2001:db8::53]"), {
		host: "2001:db8::53",
		port: 53,
	});
	assert.deepEqual(parseDnsServer("2001:db8::53"), {
		host: "2001:db8::53",
		port: 53,
	});
});

test("a redirect never receives the password", async () => {
	let forwarded = false;
	await withServer(
		(_req, res) => {
			forwarded = true;
			res.end("{}");
		},
		(elsewhere) =>
			withServer(
				(_req, res) =>
					res.writeHead(307, { location: `${elsewhere}/api/auth` }).end(),
				async (url) => {
					await assert.rejects(
						new PiHole({ url, password: "secret" }).login(),
						/redirects to http:\/\/127\.0\.0\.1:\d+\/api\/auth\. Use that address/,
					);
					assert.equal(forwarded, false);
				},
			),
	);
});

/** A Pi-hole API that records requests; routes maps "METHOD /path" → [status, body]. */
const recordingPihole = (routes, calls) => (req, res) => {
	calls.push(`${req.method} ${decodeURIComponent(req.url)}`);
	const [status, body] = routes[
		`${req.method} ${decodeURIComponent(req.url)}`
	] || [404, {}];
	res.writeHead(status, { "content-type": "application/json" });
	res.end(body === undefined ? undefined : JSON.stringify(body));
};

test("withPiHole always logs out, even when the work fails", async () => {
	const calls = [];
	const routes = {
		"POST /api/auth": [200, { session: { valid: true, sid: "abc" } }],
		"DELETE /api/auth": [204],
	};
	await withServer(recordingPihole(routes, calls), (url) =>
		assert.rejects(
			withPiHole({ piholeUrl: url }, "pw", async () => {
				throw new Error("boom");
			}),
			/boom/,
		),
	);
	assert.deepEqual(calls, ["POST /api/auth", "DELETE /api/auth"]);
});

test("deny list: duplicates are reported, missing entries aren't errors", async () => {
	const calls = [];
	const routes = {
		"POST /api/auth": [200, { session: { valid: true, sid: "abc" } }],
		"POST /api/domains/deny/regex": [
			201,
			{
				processed: {
					errors: [
						{ item: "x", error: "UNIQUE constraint failed: domainlist.domain" },
					],
				},
			},
		],
		"DELETE /api/domains/deny/exact/gone.example": [
			404,
			{ error: { message: "not found" } },
		],
	};
	await withServer(recordingPihole(routes, calls), async (url) => {
		const ph = new PiHole({ url, password: "pw" });
		await ph.login();
		assert.deepEqual(
			await ph.addDeny("regex", "(\\.|^)ads\\.example$", "adhunt"),
			{
				ok: false,
				exists: true,
				error: "UNIQUE constraint failed: domainlist.domain",
			},
		);
		assert.equal(await ph.removeDeny("exact", "gone.example"), false);
	});
});

test("query log statuses that mean already blocked", () => {
	for (const status of [
		"GRAVITY",
		"REGEX",
		"DENYLIST",
		"EXTERNAL_BLOCKED_NXRA",
		"GRAVITY_CNAME",
		"SPECIAL_DOMAIN",
	])
		assert.ok(isBlockedStatus(status), status);
	for (const status of ["FORWARDED", "CACHE", "RETRIED", "", undefined])
		assert.ok(!isBlockedStatus(status), String(status));
});
