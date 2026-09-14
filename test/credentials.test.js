import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { promptHidden, readPassword } from "../src/credentials.js";

const BACKSPACE = "\u007f";
const CTRL_C = "\u0003";

/** A fake terminal: stdin that accepts raw mode, stdout that records what is echoed. */
function fakeTty() {
	const stdin = new PassThrough();
	stdin.isTTY = true;
	stdin.calls = [];
	stdin.setRawMode = (on) => {
		stdin.calls.push(`raw:${on}`);
		return stdin;
	};
	const pause = stdin.pause.bind(stdin);
	stdin.pause = () => {
		stdin.calls.push("pause");
		return pause();
	};
	let echoed = "";
	const stdout = {
		write: (text) => {
			echoed += text;
		},
	};
	return { stdin, stdout, echoed: () => echoed };
}

test("PIHOLE_PASSWORD wins over the keychain", () => {
	assert.equal(readPassword({ PIHOLE_PASSWORD: "from-env" }), "from-env");
});

test("hidden prompt never echoes and handles backspace and Enter", async () => {
	const tty = fakeTty();
	const typed = promptHidden("Password: ", tty);
	tty.stdin.write(`s3cx${BACKSPACE}ret\r`);
	assert.equal(await typed, "s3cret");
	assert.equal(tty.echoed(), "Password: \n");
	// Windows: pausing after leaving raw mode leaves a console read that waits for Enter.
	assert.deepEqual(tty.stdin.calls, ["raw:true", "pause", "raw:false"]);
});

test("hidden prompt: Ctrl+C cancels", async () => {
	const tty = fakeTty();
	const pending = promptHidden("Password: ", tty);
	tty.stdin.write(`abc${CTRL_C}`);
	await assert.rejects(pending, /Cancelled/);
});

test("hidden prompt needs a terminal", async () => {
	await assert.rejects(
		promptHidden("Password: ", {
			stdin: new PassThrough(),
			stdout: { write() {} },
		}),
		/interactive terminal/,
	);
});
