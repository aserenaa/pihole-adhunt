import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STATE_DIR } from "./config.js";

const LAST = join(STATE_DIR, "last-scan.json");
const HISTORY = join(STATE_DIR, "history.json");

async function readJson(path, fallback) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return fallback;
	}
}
async function writeJson(path, data) {
	await mkdir(STATE_DIR, { recursive: true });
	await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

export const loadLastScan = () => readJson(LAST, null);
export const saveLastScan = (scan) => writeJson(LAST, scan);
export const loadHistory = () => readJson(HISTORY, []);
export const saveHistory = (history) => writeJson(HISTORY, history);
