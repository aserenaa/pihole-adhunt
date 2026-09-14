import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { configDir, writePrivateJson } from "../src/config.js";

test("config dir: ADHUNT_HOME wins everywhere", () => {
	assert.equal(
		configDir({ ADHUNT_HOME: "/custom" }, "win32", "C:\\Users\\me"),
		"/custom",
	);
	assert.equal(
		configDir({ ADHUNT_HOME: "/custom" }, "darwin", "/Users/me"),
		"/custom",
	);
});

test("config dir: %APPDATA% on Windows", () => {
	assert.equal(
		configDir(
			{ APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
			"win32",
			"C:\\Users\\me",
		),
		"C:\\Users\\me\\AppData\\Roaming\\adhunt",
	);
	assert.equal(
		configDir({}, "win32", "C:\\Users\\me"),
		"C:\\Users\\me\\AppData\\Roaming\\adhunt",
	);
});

test("config dir: ~/.config on macOS and Linux, or XDG_CONFIG_HOME", () => {
	assert.equal(
		configDir({}, "darwin", "/Users/me"),
		join("/Users/me", ".config", "adhunt"),
	);
	assert.equal(
		configDir({}, "linux", "/home/me"),
		join("/home/me", ".config", "adhunt"),
	);
	assert.equal(
		configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/me"),
		join("/xdg", "adhunt"),
	);
});

test("state files are private to the user", {
	skip: process.platform === "win32",
}, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "adhunt-private-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, "state", "history.json");
	await writePrivateJson(file, []);
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.equal((await stat(join(dir, "state"))).mode & 0o777, 0o700);

	const older = join(dir, "last-scan.json");
	await writeFile(older, "{}", { mode: 0o644 });
	await writePrivateJson(older, { at: "now" });
	assert.equal((await stat(older)).mode & 0o777, 0o600);
});
