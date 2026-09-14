import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { exitWhenFlushed, printable, prompt } from "../src/terminal.js";

const BACKSPACE = "\u007f";
const CTRL_C = "\u0003";
const LEFT = "\u001b[D";

/**
 * A fake terminal. Like process.stdin, it stops reading one tick after pause(), and it records
 * the order of pause, the real read stop and raw mode changes.
 */
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
		process.nextTick(() => stdin.calls.push("readStop"));
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

test("hidden prompt: no echo, backspace, and raw mode left only after reading stops", async () => {
	const tty = fakeTty();
	const typed = prompt("Password: ", { hidden: true, ...tty });
	tty.stdin.write(`s3cx${BACKSPACE}ret\r`);
	assert.equal(await typed, "s3cret");
	assert.equal(tty.echoed(), "Password: \n");
	// Windows: leaving raw mode before the read stops starts a console read that waits for Enter.
	assert.deepEqual(tty.stdin.calls, [
		"raw:true",
		"pause",
		"readStop",
		"raw:false",
	]);
});

test("visible prompt echoes, erases and ignores arrow keys", async () => {
	const tty = fakeTty();
	const typed = prompt("URL: ", tty);
	tty.stdin.write(`pi.hox${BACKSPACE}${LEFT}le\r`);
	assert.equal(await typed, "pi.hole");
	assert.equal(tty.echoed(), "URL: pi.hox\b \ble\n");
});

test("prompt: Ctrl+C cancels and still restores the terminal", async () => {
	const tty = fakeTty();
	const pending = prompt("Password: ", { hidden: true, ...tty });
	tty.stdin.write(`abc${CTRL_C}`);
	await assert.rejects(pending, /Cancelled/);
	assert.equal(tty.stdin.calls.at(-1), "raw:false");
});

test("prompt without a terminal: reads a line from the pipe, never a password", async () => {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const answer = prompt("URL: ", { stdin, stdout });
	stdin.write("http://pi.hole\n");
	assert.equal(await answer, "http://pi.hole");
	await assert.rejects(
		prompt("Password: ", { hidden: true, stdin: new PassThrough(), stdout }),
		/interactive terminal/,
	);
});

test("exitWhenFlushed exits once every stream has flushed", () => {
	const callbacks = [];
	const stream = { write: (_text, cb) => callbacks.push(cb) };
	let exitedWith;
	exitWhenFlushed(3, {
		streams: [stream, stream],
		exit: (code) => {
			exitedWith = code;
		},
	});
	callbacks[0]();
	assert.equal(exitedWith, undefined);
	callbacks[1]();
	assert.equal(exitedWith, 3);
	process.exitCode = 0;
});

test("printable strips control characters but keeps text and emoji", () => {
	const ESC = "\u001b";
	assert.equal(
		printable(`News${ESC}]0;owned\u0007 — café 🎉`),
		"News]0;owned — café 🎉",
	);
	assert.equal(printable(`a\u009b2Jb\r\nc`), "a2Jbc");
	assert.equal(
		printable("line 1\nline 2", { keepNewlines: true }),
		"line 1\nline 2",
	);
	assert.equal(printable(undefined), "");
});

test("prompt without a terminal fails when the input ends first", async () => {
	const stdin = new PassThrough();
	const answer = prompt("URL: ", { stdin, stdout: new PassThrough() });
	stdin.end();
	await assert.rejects(answer, /input ended/);
});
