import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { STATE_DIR, writePrivateJson } from "./config.js";

const LAST = join(STATE_DIR, "last-scan.json");
const HISTORY = join(STATE_DIR, "history.json");

async function readJson(path, fallback) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return fallback;
	}
}

export const loadLastScan = () => readJson(LAST, null);
export const saveLastScan = (scan) => writePrivateJson(LAST, scan);
export const loadHistory = () => readJson(HISTORY, []);
export const saveHistory = (history) => writePrivateJson(HISTORY, history);
