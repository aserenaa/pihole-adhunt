import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
	initialState,
	menuRows,
	onKey,
	renderMenu,
	selectCandidates,
} from "../src/menu.js";

const cand = (n, target, group, extra = {}) => ({
	n,
	target,
	group,
	kind: "regex",
	preselected: group === "block",
	label: "",
	requests: 1,
	reasons: [`rule ||${target}^`],
	hosts: [target],
	...extra,
});
const candidates = [
	cand(1, "ads.example", "block"),
	cand(2, "track.example", "block", {
		hosts: ["a.track.example", "b.track.example"],
	}),
	cand(3, "tagmanager.example", "review"),
	cand(4, "cdn.example", "unknown", {
		kind: "exact",
		reasons: [],
		label: "CDN\u001b[2J",
	}),
];
// Rows: 0 BLOCK · 1 ads · 2 track · 3 REVIEW · 4 tagmanager · 5 UNKNOWN · 6 cdn
//       7 separator · 8 Block selected · 9 Block recommended · 10 Nothing
const rows = menuRows(candidates);
const key = (name, extra = {}) => ({ name, ...extra });
const press = (state, ...names) =>
	names.reduce((s, name) => onKey(rows, s, key(name)).state, state);

test("menu rows: groups with candidates, then the actions", () => {
	assert.deepEqual(
		rows.map((r) => r.type),
		[
			"header",
			"item",
			"item",
			"header",
			"item",
			"header",
			"item",
			"separator",
			"action",
			"action",
			"action",
		],
	);
	const state = initialState(rows);
	assert.equal(state.cursor, 1);
	assert.deepEqual([...state.selected], [1, 2]);
});

test("arrows skip headers and the separator, and wrap around", () => {
	const start = initialState(rows);
	assert.equal(press(start, "down", "down").cursor, 4);
	assert.equal(press(start, "up").cursor, 10);
	assert.equal(press({ ...start, cursor: 6 }, "down").cursor, 8);
	assert.equal(press(start, "j", "k").cursor, 1);
	assert.equal(press(start, "end").cursor, 10);
});

test("space and enter toggle domains; r and n reset the marks", () => {
	const start = initialState(rows);
	const toggled = press(start, "down", "down", "space");
	assert.deepEqual([...toggled.selected].sort(), [1, 2, 3]);
	assert.deepEqual([...press(toggled, "return").selected].sort(), [1, 2]);
	assert.deepEqual([...press(toggled, "n").selected], []);
	assert.deepEqual(
		[...press(press(toggled, "n"), "r").selected].sort(),
		[1, 2],
	);
});

test("actions: block selected, block recommended, nothing, cancel", () => {
	const marked = press(initialState(rows), "down", "down", "space"); // + tagmanager
	const run = (state, cursor, name = "return", extra) =>
		onKey(rows, { ...state, cursor }, key(name, extra));

	const selected = run(marked, 8);
	assert.equal(selected.action, "selected");
	assert.deepEqual(
		selected.result.map((c) => c.n),
		[1, 2, 3],
	);
	assert.deepEqual(
		run(marked, 9).result.map((c) => c.n),
		[1, 2],
	);
	assert.deepEqual(run(marked, 10).result, []);
	assert.equal(run(marked, 1, "escape").action, "cancel");
	assert.deepEqual(run(marked, 1, "c", { ctrl: true }).result, []);
	assert.equal(
		run(marked, 8, "space").state.cursor,
		8,
		"space never runs an action",
	);
});

test("render: marks, cursor, counts and details of the focused row", () => {
	const state = press(initialState(rows), "down"); // on track.example
	const { lines } = renderMenu(rows, state, { columns: 100, height: 30 });
	const text = lines.join("\n");
	assert.match(text, /^Block which\? {2}↑↓ move/);
	assert.match(text, /\n {2}\[x\] ads\.example \(\+subdomains\)/);
	assert.match(text, /\n❯ \[x\] track\.example \(\+subdomains\)/);
	assert.match(text, /\n {2}\[ \] cdn\.example +CDN\[2J · 1 req/);
	assert.match(
		text,
		/▸ Block selected \(2\)\n {2}▸ Block recommended \(2\)\n {2}▸ Nothing/,
	);
	assert.match(
		text,
		/rule \|\|track\.example\^\n {2}hosts: a\.track\.example, b\.track\.example$/,
	);
	const onAction = renderMenu(
		rows,
		{ ...state, cursor: 9 },
		{ columns: 100, height: 30 },
	);
	assert.match(
		onAction.lines.at(-1),
		/will block: ads\.example, track\.example/,
	);
});

test("render: long lists scroll inside the terminal and lines never wrap", () => {
	const many = Array.from({ length: 30 }, (_, i) =>
		cand(
			i + 1,
			`ads-network-${i + 1}-with-a-rather-long-name.example`,
			"block",
		),
	);
	const bigRows = menuRows(many);
	const state = { ...initialState(bigRows), cursor: 25 };
	const { lines, offset } = renderMenu(bigRows, state, {
		columns: 50,
		height: 20,
	});
	assert.ok(lines.length <= 19, `${lines.length} lines fit in 20 rows`);
	assert.ok(
		lines.every((l) => l.length <= 49),
		"cut to the width",
	);
	assert.ok(offset > 0);
	assert.match(lines.join("\n"), /↑ \d+ more/);
	assert.match(lines.join("\n"), /↓ \d+ more/);
	assert.ok(lines.some((l) => l.startsWith("❯ [x] ads-network-25")));
});

test("selectCandidates reads arrow keys from the terminal", async () => {
	const stdin = new PassThrough();
	stdin.isTTY = true;
	stdin.setRawMode = () => stdin;
	const stdout = new PassThrough();
	let output = "";
	stdout.on("data", (chunk) => {
		output += chunk;
	});
	stdout.columns = 100;
	stdout.rows = 30;

	const picked = selectCandidates({ candidates }, { stdin, stdout });
	const DOWN = "\u001b[B";
	// Unmark track.example, then go down to "Block selected" and confirm.
	stdin.write(`${DOWN} ${DOWN}${DOWN}${DOWN}\r`);
	assert.deepEqual(
		(await picked).map((c) => c.target),
		["ads.example"],
	);
	assert.ok(output.includes("\u001b[?25h"), "cursor shown again");
	assert.match(output, /\[x\] ads\.example[^\n]*\n {2}\[ \] track\.example/);
});
