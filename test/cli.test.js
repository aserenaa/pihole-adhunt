import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createSocket } from "node:dgram";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadEngines } from "../src/analyze.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const HAR = fileURLToPath(new URL("./fixtures/news.har", import.meta.url));
const ENGINE_CACHE =
	process.env.ADHUNT_TEST_CACHE || join(tmpdir(), "adhunt-test-cache");

/**
 * An in-memory Pi-hole v6: the REST API adhunt uses, plus a DNS server that answers 0.0.0.0
 * (NULL blocking mode) for denied names and a documentation address for everything else.
 * failAdds: how many adds succeed before the API starts answering 500.
 */
async function fakePihole({
	failAdds = Number.POSITIVE_INFINITY,
	password = "test",
} = {}) {
	const deny = [];
	const denied = (name) =>
		deny.some((e) =>
			e.kind === "regex" ? new RegExp(e.domain).test(name) : e.domain === name,
		);
	const json = (res, status, body) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const api = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
			if (path === "/api/auth" && req.method === "POST") {
				const valid = JSON.parse(body).password === password;
				return json(res, valid ? 200 : 401, { session: { valid, sid: "sid" } });
			}
			if (path === "/api/auth") return res.writeHead(204).end();
			if (path === "/api/config/dns/blocking")
				return json(res, 200, {
					config: { dns: { blocking: { active: true, mode: "NULL" } } },
				});
			if (path === "/api/config/dns/reply")
				return json(res, 200, { config: { dns: { reply: { blocking: {} } } } });
			if (path === "/api/domains/deny" && req.method === "GET")
				return json(res, 200, { domains: deny });
			const add = /^\/api\/domains\/deny\/(exact|regex)$/.exec(path);
			if (add && req.method === "POST") {
				if (deny.length >= failAdds)
					return json(res, 500, { error: { message: "database is locked" } });
				const { domain, comment } = JSON.parse(body);
				for (const d of domain)
					deny.push({ kind: add[1], domain: d, comment, enabled: true });
				return json(res, 201, { processed: { errors: [] } });
			}
			const del = /^\/api\/domains\/deny\/(exact|regex)\/(.+)$/.exec(path);
			if (del && req.method === "DELETE") {
				const i = deny.findIndex(
					(e) => e.kind === del[1] && e.domain === del[2],
				);
				if (i < 0) return json(res, 404, { error: { message: "not found" } });
				deny.splice(i, 1);
				return res.writeHead(204).end();
			}
			json(res, 404, { error: { message: `no route for ${path}` } });
		});
	});
	const dns = createSocket("udp4");
	dns.on("message", (msg, client) => {
		let i = 12;
		const labels = [];
		while (msg[i] !== 0) {
			labels.push(msg.subarray(i + 1, i + 1 + msg[i]).toString());
			i += msg[i] + 1;
		}
		const isA = msg.readUInt16BE(i + 1) === 1;
		const header = Buffer.from(msg.subarray(0, 12));
		header.writeUInt16BE(0x8180, 2);
		header.writeUInt16BE(1, 4);
		header.writeUInt16BE(isA ? 1 : 0, 6);
		header.writeUInt16BE(0, 8);
		header.writeUInt16BE(0, 10);
		const ip = denied(labels.join(".")) ? [0, 0, 0, 0] : [203, 0, 113, 1];
		const answer = isA
			? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...ip])
			: Buffer.alloc(0);
		dns.send(
			Buffer.concat([header, msg.subarray(12, i + 5), answer]),
			client.port,
			client.address,
		);
	});
	await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
	await new Promise((resolve) => dns.bind(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${api.address().port}`,
		dnsServer: `127.0.0.1:${dns.address().port}`,
		deny,
		close: () => {
			api.close();
			dns.close();
		},
	};
}

let home;
let pihole;

before(async () => {
	await loadEngines(ENGINE_CACHE);
	home = await mkdtemp(join(tmpdir(), "adhunt-cli-"));
	await mkdir(join(home, "cache"));
	await copyFile(
		join(ENGINE_CACHE, "ghostery-ads-tracking.bin"),
		join(home, "cache", "ghostery-ads-tracking.bin"),
	);
});

after(() => rm(home, { recursive: true, force: true }));

/** Runs the CLI against the fake Pi-hole → { code, stdout, stderr }. */
const adhunt = (...args) => adhuntWith({}, ...args);

/** input: text piped to stdin; env: extra or replaced environment variables. */
function adhuntWith({ input, env = {} }, ...args) {
	return new Promise((resolve) => {
		const child = execFile(
			process.execPath,
			[CLI, ...args],
			{
				env: {
					PATH: process.env.PATH,
					SYSTEMROOT: process.env.SYSTEMROOT,
					ADHUNT_HOME: home,
					PIHOLE_URL: pihole.url,
					PIHOLE_PASSWORD: "test",
					PIHOLE_DNS: pihole.dnsServer,
					NO_COLOR: "1",
					...env,
				},
				timeout: 60_000,
			},
			(error, stdout, stderr) =>
				resolve({ code: error ? error.code : 0, stdout, stderr }),
		);
		child.stdin.end(input);
	});
}

const history = async () =>
	JSON.parse(await readFile(join(home, "state", "history.json"), "utf8"));

test("block, list, remove and undo against Pi-hole", async (t) => {
	pihole = await fakePihole();
	t.after(pihole.close);
	const scan = await adhunt("--har", HAR, "--yes");
	assert.equal(scan.code, 0, scan.stderr);
	assert.match(scan.stdout, /Blocked 6 in Pi-hole · verified via DNS: 6\/6/);
	assert.equal(pihole.deny.length, 6);
	assert.ok(pihole.deny.every((e) => e.kind === "regex"));
	assert.match(
		pihole.deny[0].comment,
		/^adhunt · www\.example-news\.com · \d{4}-\d{2}-\d{2}/,
	);
	assert.equal((await history()).at(-1).items.length, 6);

	const list = await adhunt("list");
	assert.match(list.stdout, /taboola\.com \(\+subdomains\)/);
	assert.match(list.stdout, /6 entries/);

	assert.equal((await adhunt("remove", "taboola.com")).code, 0);
	assert.equal(pihole.deny.length, 5);

	const undo = await adhunt("undo");
	assert.equal(undo.code, 0, undo.stderr);
	assert.equal(pihole.deny.length, 0);
	assert.deepEqual(await history(), []);
});

test("a Pi-hole error midway keeps what was added undoable", async (t) => {
	pihole = await fakePihole({ failAdds: 2 });
	t.after(pihole.close);
	const scan = await adhunt("--har", HAR, "--yes");
	assert.equal(scan.code, 1);
	assert.match(scan.stderr, /database is locked/);
	assert.equal(pihole.deny.length, 2);
	assert.equal((await history()).at(-1).items.length, 2);

	assert.equal((await adhunt("undo")).code, 0);
	assert.equal(pihole.deny.length, 0);
});

test("setup saves a normalized URL only after logging in", async (t) => {
	pihole = await fakePihole({ password: "right" });
	t.after(pihole.close);
	const config = join(home, "config.json");
	const unset = { PIHOLE_URL: "" };

	const wrong = await adhuntWith(
		{
			input: `${pihole.url}/admin/\n`,
			env: { ...unset, PIHOLE_PASSWORD: "wrong" },
		},
		"setup",
	);
	assert.equal(wrong.code, 1);
	assert.match(wrong.stderr, /rejected the password/);
	await assert.rejects(stat(config), { code: "ENOENT" });

	const right = await adhuntWith(
		{
			input: `${pihole.url}/admin/\n`,
			env: { ...unset, PIHOLE_PASSWORD: "right" },
		},
		"setup",
	);
	assert.equal(right.code, 0, right.stderr);
	assert.match(right.stdout, /Connected to Pi-hole/);
	// PIHOLE_DNS came from the environment, so it isn't written to the file.
	assert.deepEqual(JSON.parse(await readFile(config, "utf8")), {
		piholeUrl: pihole.url,
	});
});

test("a Pi-hole DNS that doesn't answer is reported", async (t) => {
	pihole = await fakePihole();
	t.after(pihole.close);
	// A UDP socket that never replies stands in for DNS served somewhere else.
	const silent = createSocket("udp4");
	await new Promise((resolve) => silent.bind(0, "127.0.0.1", resolve));
	t.after(() => silent.close());
	const scan = await adhuntWith(
		{ env: { PIHOLE_DNS: `127.0.0.1:${silent.address().port}` } },
		"--har",
		HAR,
		"--json",
	);
	assert.equal(scan.code, 0, scan.stderr);
	assert.match(
		scan.stderr,
		/DNS at 127\.0\.0\.1:\d+ did not answer.*set PIHOLE_DNS/,
	);
});
