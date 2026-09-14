import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

/**
 * Where config, state and cache live: ADHUNT_HOME, else %APPDATA%\adhunt on Windows,
 * else $XDG_CONFIG_HOME/adhunt or ~/.config/adhunt (macOS included).
 */
export function configDir(
	env = process.env,
	platform = process.platform,
	home = homedir(),
) {
	if (env.ADHUNT_HOME) return env.ADHUNT_HOME;
	if (platform === "win32")
		return win32.join(
			env.APPDATA || win32.join(home, "AppData", "Roaming"),
			"adhunt",
		);
	return join(env.XDG_CONFIG_HOME || join(home, ".config"), "adhunt");
}

export const CONFIG_DIR = configDir();
export const STATE_DIR = join(CONFIG_DIR, "state");
export const CACHE_DIR = join(CONFIG_DIR, "cache");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS = { piholeUrl: "", dnsServer: "" };

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
