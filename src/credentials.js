import { createRequire } from "node:module";

// Same service and account as items created with
// `security add-generic-password -s adhunt-pihole -a pihole`, so they keep working.
const SERVICE = "adhunt-pihole";
const ACCOUNT = "pihole";

export const keychainName =
	{ darwin: "macOS Keychain", win32: "Windows Credential Manager" }[
		process.platform
	] || "system keyring (Secret Service)";

const require = createRequire(import.meta.url);

function entry() {
	// Loaded lazily: without a native binary or keyring backend only the keychain is unavailable.
	const { Entry } = require("@napi-rs/keyring");
	return new Entry(SERVICE, ACCOUNT);
}

/** The password stored in the OS keychain, or null (none stored, locked, or no keychain). */
export function storedPassword() {
	try {
		return entry().getPassword() || null;
	} catch {
		return null;
	}
}

/** Pi-hole app password: PIHOLE_PASSWORD first, then the OS keychain. */
export function readPassword(env = process.env) {
	return env.PIHOLE_PASSWORD || storedPassword();
}

export function savePassword(password) {
	try {
		entry().setPassword(password);
	} catch (e) {
		throw new Error(
			`Could not store the password in the ${keychainName} (${e.message}). Set PIHOLE_PASSWORD instead.`,
		);
	}
}

/** Removes the stored password → true if there was one. */
export function forgetPassword() {
	try {
		return entry().deletePassword();
	} catch (e) {
		throw new Error(
			`Could not remove the password from the ${keychainName} (${e.message}).`,
		);
	}
}

/**
 * Stops reading, then leaves raw mode. The order matters on Windows: leaving raw mode while
 * still reading restarts a line-mode console read that keeps the process alive until Enter.
 */
export function restoreTerminal(stdin) {
	stdin.pause();
	stdin.setRawMode(false);
}

const ENTER = new Set(["\r", "\n", "\u0004"]); // Ctrl+D also ends the input
const CTRL_C = "\u0003";
const BACKSPACE = new Set(["\u007f", "\b"]);

/** Reads a line from the terminal without echoing it (the password never reaches argv or a file). */
export function promptHidden(
	question,
	{ stdin = process.stdin, stdout = process.stdout } = {},
) {
	return new Promise((resolve, reject) => {
		if (!stdin.isTTY)
			return reject(
				new Error(
					"An interactive terminal is required to type the password (or set PIHOLE_PASSWORD).",
				),
			);
		stdout.write(question);
		stdin.setRawMode(true);
		stdin.setEncoding("utf8");
		stdin.resume();
		let value = "";
		const finish = (settle, result) => {
			stdin.off("data", onData);
			restoreTerminal(stdin);
			stdout.write("\n");
			settle(result);
		};
		const onData = (chunk) => {
			for (const ch of chunk) {
				if (ENTER.has(ch)) return finish(resolve, value);
				if (ch === CTRL_C) return finish(reject, new Error("Cancelled."));
				if (BACKSPACE.has(ch)) value = value.slice(0, -1);
				else if (ch >= " ") value += ch;
			}
		};
		stdin.on("data", onData);
	});
}
