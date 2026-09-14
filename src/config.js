import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR =
	process.env.ADHUNT_HOME || join(homedir(), ".config", "adhunt");
export const STATE_DIR = join(CONFIG_DIR, "state");
export const CACHE_DIR = join(CONFIG_DIR, "cache");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS = { piholeUrl: "", dnsServer: "" };
const KEYCHAIN = ["-s", "adhunt-pihole", "-a", "pihole"];

export async function loadConfig() {
	let file = {};
	try {
		file = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
	} catch {}
	const cfg = { ...DEFAULTS, ...file };
	if (process.env.PIHOLE_URL) cfg.piholeUrl = process.env.PIHOLE_URL;
	if (process.env.PIHOLE_DNS) cfg.dnsServer = process.env.PIHOLE_DNS;
	cfg.piholeUrl = cfg.piholeUrl.replace(/\/+$/, "");
	return cfg;
}

export async function saveConfig(cfg) {
	await mkdir(CONFIG_DIR, { recursive: true });
	await writeFile(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`);
	return CONFIG_FILE;
}

/** Pi-hole app password: PIHOLE_PASSWORD, or the macOS Keychain. */
export function getPassword() {
	if (process.env.PIHOLE_PASSWORD) return process.env.PIHOLE_PASSWORD;
	if (platform() === "darwin") {
		const r = spawnSync(
			"security",
			["find-generic-password", ...KEYCHAIN, "-w"],
			{ encoding: "utf8" },
		);
		if (r.status === 0) return r.stdout.trim();
	}
	return null;
}

/** Stores the password in the Keychain. A trailing `-w` makes `security` prompt for it. */
export function storePassword() {
	if (platform() !== "darwin") return false;
	const r = spawnSync(
		"security",
		["add-generic-password", "-U", ...KEYCHAIN, "-w"],
		{ stdio: "inherit" },
	);
	return r.status === 0;
}
