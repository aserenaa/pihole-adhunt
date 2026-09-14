import { lookup, Resolver } from "node:dns/promises";
import { isIP } from "node:net";

// Pi-hole v6 query log statuses that mean "already blocked".
const BLOCKED_STATUS =
	/^(GRAVITY|REGEX|DENYLIST|EXTERNAL_BLOCKED|SPECIAL_DOMAIN)/;
export const isBlockedStatus = (status) => BLOCKED_STATUS.test(status || "");

/** Regex in the same format as `pihole --wild`: the domain and all of its subdomains. */
export const toWildcard = (domain) =>
	`(\\.|^)${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
export const fromWildcard = (regex) => {
	const m = /^\(\\\.\|\^\)(.+)\$$/.exec(regex);
	return m ? m[1].replace(/\\(.)/g, "$1") : null;
};

export class PiHole {
	constructor({ url, password }) {
		this.url = url;
		this.password = password;
		this.sid = null;
	}

	async request(method, path, body) {
		let res;
		try {
			res = await fetch(this.url + path, {
				method,
				headers: {
					"content-type": "application/json",
					...(this.sid && { "X-FTL-SID": this.sid }),
				},
				body: body && JSON.stringify(body),
				signal: AbortSignal.timeout(15000),
			});
		} catch (e) {
			throw new Error(
				`Could not connect to Pi-hole at ${this.url} (${e.cause?.code || e.name}). Is it reachable from this computer?`,
			);
		}
		if (res.status === 204) return null;
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const err = new Error(
				`Pi-hole ${method} ${path} → ${res.status}: ${data.error?.message || res.statusText}`,
			);
			err.status = res.status;
			throw err;
		}
		return data;
	}

	async login() {
		// Pi-hole v5 has no /api/auth: its web server answers 404, or an HTML page without a session.
		const v6Required = new Error(
			`Pi-hole v6 or newer is required (no v6 API at ${this.url}/api/auth). Check the URL, or upgrade with "pihole -up".`,
		);
		const data = await this.request("POST", "/api/auth", {
			password: this.password,
		}).catch((e) => {
			if (e.status === 401)
				throw new Error(
					"Pi-hole rejected the password (use the app password: Settings → Web interface / API).",
				);
			if (e.status === 404 || e.status === 405) throw v6Required;
			throw e;
		});
		if (!data?.session) throw v6Required;
		if (!data.session.valid)
			throw new Error(
				"Pi-hole did not open a session (is the password correct?).",
			);
		this.sid = data.session.sid;
	}

	// Pi-hole limits concurrent sessions: always log out.
	async logout() {
		if (!this.sid) return;
		await this.request("DELETE", "/api/auth").catch(() => {});
		this.sid = null;
	}

	/** kind: 'exact' | 'regex'. Returns { ok, exists, error }. */
	async addDeny(kind, domain, comment) {
		const data = await this.request("POST", `/api/domains/deny/${kind}`, {
			domain: [domain],
			comment,
			groups: [0],
			enabled: true,
		});
		const error = data?.processed?.errors?.[0]?.error;
		if (!error) return { ok: true };
		return { ok: false, exists: /UNIQUE/i.test(error), error };
	}

	async removeDeny(kind, domain) {
		try {
			await this.request(
				"DELETE",
				`/api/domains/deny/${kind}/${encodeURIComponent(domain)}`,
			);
			return true;
		} catch (e) {
			if (e.status === 404) return false;
			throw e;
		}
	}

	async listDeny() {
		return (await this.request("GET", "/api/domains/deny")).domains || [];
	}

	async queries({ clientIp, from, until }) {
		const qs = new URLSearchParams({
			client_ip: clientIp,
			from,
			until,
			length: "20000",
		});
		return (await this.request("GET", `/api/queries?${qs}`)).queries || [];
	}

	/** How Pi-hole answers blocked queries → { active, mode, ipv4 }. */
	async blocking() {
		const [blocking, reply] = await Promise.all([
			this.request("GET", "/api/config/dns/blocking"),
			this.request("GET", "/api/config/dns/reply"),
		]);
		const { active, mode } = blocking?.config?.dns?.blocking || {};
		const { force4, IPv4 } = reply?.config?.dns?.reply?.blocking || {};
		return {
			active: active !== false,
			mode: mode || "NULL",
			ipv4: force4 ? IPv4 : "",
		};
	}

	async topClients(count = 15) {
		return (
			(await this.request("GET", `/api/stats/top_clients?count=${count}`))
				.clients || []
		);
	}
}

export async function withPiHole(cfg, password, fn) {
	const ph = new PiHole({ url: cfg.piholeUrl, password });
	await ph.login();
	try {
		return await fn(ph);
	} finally {
		await ph.logout();
	}
}

/**
 * Reads one DNS answer the way Pi-hole's blocking mode writes it → 'blocked' | 'ok' | 'nx' | 'error'.
 * answer: { addresses } from resolve4(), or { code } from its error. server: the Pi-hole IP queried.
 * - NULL: 0.0.0.0 · IP / IP_NODATA_AAAA: dns.reply.blocking.IPv4 if forced, else Pi-hole's own IP
 * - NX: NXDOMAIN (indistinguishable from a dead domain) · NODATA: an empty answer
 */
export function dnsAnswerStatus(
	answer,
	{ mode = "NULL", ipv4 = "" } = {},
	server = "",
) {
	if (answer.addresses) {
		const ipMode = mode === "IP" || mode === "IP_NODATA_AAAA";
		const blockedIp = ipMode ? ipv4 || server : "";
		return answer.addresses.some((ip) => ip === "0.0.0.0" || ip === blockedIp)
			? "blocked"
			: "ok";
	}
	if (answer.code === "ENOTFOUND") return mode === "NX" ? "blocked" : "nx";
	if (answer.code === "ENODATA") return mode === "NODATA" ? "blocked" : "ok";
	return "error";
}

/**
 * Asks Pi-hole's DNS directly (not the system resolver) → 'blocked' | 'ok' | 'nx' | 'error'.
 * That way the result covers gravity, regex and CNAMEs even if this computer uses another DNS.
 * blocking: PiHole#blocking(), so answers are read according to the configured blocking mode.
 */
export async function makeDnsChecker(cfg, blocking) {
	let server = cfg.dnsServer || new URL(cfg.piholeUrl).hostname;
	if (!isIP(server)) server = (await lookup(server, { family: 4 })).address;
	const resolver = new Resolver({ timeout: 2500, tries: 2 });
	resolver.setServers([server]);
	const cache = new Map();
	const check = async (host) => {
		try {
			const addresses = await resolver.resolve4(host);
			return dnsAnswerStatus({ addresses }, blocking, server);
		} catch (e) {
			return dnsAnswerStatus({ code: e.code }, blocking, server);
		}
	};
	const one = (host) => {
		if (!cache.has(host)) cache.set(host, check(host));
		return cache.get(host);
	};
	/** Checks many hosts with limited concurrency → Map host → status. */
	one.many = async (hosts, concurrency = 16) => {
		const list = [...new Set(hosts)];
		const out = new Map();
		let i = 0;
		await Promise.all(
			Array.from({ length: Math.min(concurrency, list.length) }, async () => {
				while (i < list.length) {
					const h = list[i++];
					out.set(h, await one(h));
				}
			}),
		);
		return out;
	};
	one.server = server;
	return one;
}
