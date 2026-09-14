import { createInterface } from "node:readline/promises";

const ENTER = new Set(["\r", "\n", "\u0004"]); // Ctrl+D also ends the input
const CTRL_C = "\u0003";
const ESC = "\u001b";
const BACKSPACE = new Set(["\u007f", "\b"]);

/**
 * Removes control characters (C0, DEL and C1) from text that came from outside, such as page
 * titles, HAR files or Pi-hole comments, so it can't move the cursor or rewrite the screen.
 * keepNewlines keeps line breaks for multi-line messages written by adhunt itself.
 */
export function printable(text, { keepNewlines = false } = {}) {
	let out = "";
	for (const ch of String(text ?? "")) {
		const code = ch.codePointAt(0);
		const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
		if (!control || (keepNewlines && ch === "\n")) out += ch;
	}
	return out;
}

/**
 * Leaves raw mode only once stdin has really stopped reading. process.stdin stops its read
 * one tick after pause(); changing the mode while that read is active makes Windows restart
 * it as a line-mode console read, which can only be cancelled by pressing Enter.
 */
export async function restoreTerminal(stdin) {
	stdin.pause();
	await new Promise((resolve) => setImmediate(resolve));
	stdin.setRawMode(false);
}

/**
 * Asks for one line → the text typed. Terminals are read in raw mode rather than with readline,
 * whose line-mode reads keep Windows consoles waiting for an extra Enter (see restoreTerminal).
 * hidden: don't echo, for passwords (they never reach argv, a file or the screen).
 * Without a terminal, a visible question reads one line from the pipe instead.
 */
export async function prompt(
	question,
	{ hidden = false, stdin = process.stdin, stdout = process.stdout } = {},
) {
	if (!stdin.isTTY) {
		if (hidden)
			throw new Error(
				"An interactive terminal is required to type the password (or set PIHOLE_PASSWORD).",
			);
		const rl = createInterface({
			input: stdin,
			output: stdout,
			terminal: false,
		});
		try {
			return await rl.question(question);
		} finally {
			rl.close();
		}
	}

	stdout.write(question);
	stdin.setRawMode(true);
	stdin.setEncoding("utf8");
	stdin.resume();
	try {
		return await new Promise((resolve, reject) => {
			let value = "";
			let sequence = ""; // an escape sequence (arrow keys…) being skipped
			const done = (settle, result) => {
				stdin.off("data", onData);
				settle(result);
			};
			const onData = (chunk) => {
				for (const ch of chunk) {
					if (sequence) {
						// ESC [ parameters final-byte, ESC O key, or ESC plus one key.
						sequence += ch;
						const csi = sequence[1] === "[";
						const ended = csi
							? sequence.length > 2 && ch >= "@" && ch <= "~"
							: sequence.length === 3 || (sequence.length === 2 && ch !== "O");
						if (ended) sequence = "";
						continue;
					}
					if (ch === ESC) {
						sequence = ch;
						continue;
					}
					if (ENTER.has(ch)) return done(resolve, value);
					if (ch === CTRL_C) return done(reject, new Error("Cancelled."));
					if (BACKSPACE.has(ch)) {
						if (value && !hidden) stdout.write("\b \b");
						value = value.slice(0, -1);
					} else if (ch >= " ") {
						value += ch;
						if (!hidden) stdout.write(ch);
					}
				}
			};
			stdin.on("data", onData);
		});
	} finally {
		await restoreTerminal(stdin);
		stdout.write("\n");
	}
}

/**
 * Exits as soon as stdout and stderr have flushed. A finished command must not wait on a
 * stray handle, such as a Windows console read that could not be cancelled.
 */
export function exitWhenFlushed(
	code,
	{ streams = [process.stdout, process.stderr], exit = process.exit } = {},
) {
	process.exitCode = code;
	let pending = streams.length;
	for (const stream of streams)
		stream.write("", () => {
			pending -= 1;
			if (pending === 0) exit(code);
		});
}
