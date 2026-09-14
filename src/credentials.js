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
