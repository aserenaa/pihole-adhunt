import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { configDir } from "../src/config.js";

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
