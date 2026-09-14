import {
	clearScreenDown,
	cursorTo,
	emitKeypressEvents,
	moveCursor,
} from "node:readline";

import { restoreTerminal } from "./credentials.js";

const GROUP_TITLES = {
	block: "🔴 BLOCK",
	review: "🟠 REVIEW",
	unknown: "🟡 UNKNOWN",
};
const ACTION_LABELS = {
	selected: "Block selected",
	recommended: "Block recommended",
	nothing: "Nothing",
};
const HELP =
	"↑↓ move · space toggle · r recommended · n none · enter confirm · esc cancel";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

const plain = (_style, text) => text;
const selectable = (row) => row.type === "item" || row.type === "action";
const recommended = (items) =>
	new Set(items.filter((c) => c.preselected).map((c) => c.n));

/** Menu rows: a header per group, its candidates, a separator and the final actions. */
export function menuRows(candidates) {
	const rows = [];
	for (const group of Object.keys(GROUP_TITLES)) {
		const items = candidates.filter((c) => c.group === group);
		if (!items.length) continue;
		rows.push({ type: "header", group });
		for (const cand of items) rows.push({ type: "item", cand });
	}
	rows.push({ type: "separator" });
	for (const action of Object.keys(ACTION_LABELS))
		rows.push({ type: "action", action });
	return rows;
}

const itemsOf = (rows) =>
	rows.filter((r) => r.type === "item").map((r) => r.cand);
const SUBDOMAINS = " (+subdomains)";
const targetWidth = (items) =>
	Math.min(
		40,
		Math.max(
			0,
			...items.map(
				(c) => c.target.length + (c.kind === "regex" ? SUBDOMAINS.length : 0),
			),
		),
	);

/** Cursor on the first candidate, recommended candidates already marked. */
export function initialState(rows) {
	return {
		cursor: rows.findIndex(selectable),
		selected: recommended(itemsOf(rows)),
		offset: 0,
	};
}

/**
 * Applies a keypress → { state } to keep going, or { action, result } with the
 * candidates to block (empty for "nothing" or a cancel).
 */
export function onKey(rows, state, key = {}) {
	const items = itemsOf(rows);
	const finish = (action, marked) => ({
		action,
		result: items.filter((c) => marked.has(c.n)),
	});
	const move = (step) => {
		let i = state.cursor;
		do i = (i + step + rows.length) % rows.length;
		while (!selectable(rows[i]));
		return { state: { ...state, cursor: i } };
	};
	if (key.ctrl && key.name === "c") return finish("cancel", new Set());
	if (key.ctrl || key.meta) return { state };

	const row = rows[state.cursor];
	switch (key.name) {
		case "up":
		case "k":
			return move(-1);
		case "down":
		case "j":
			return move(1);
		case "home":
			return { state: { ...state, cursor: rows.findIndex(selectable) } };
		case "end":
			return { state: { ...state, cursor: rows.length - 1 } };
		case "r":
			return { state: { ...state, selected: recommended(items) } };
		case "n":
			return { state: { ...state, selected: new Set() } };
		case "escape":
		case "q":
			return finish("cancel", new Set());
		case "space":
		case "return":
		case "enter": {
			if (row.type === "item") {
				const selected = new Set(state.selected);
				if (selected.has(row.cand.n)) selected.delete(row.cand.n);
				else selected.add(row.cand.n);
				return { state: { ...state, selected } };
			}
			if (key.name === "space") return { state };
			if (row.action === "selected") return finish("selected", state.selected);
			if (row.action === "recommended")
				return finish("recommended", recommended(items));
			return finish("nothing", new Set());
		}
		default:
			return { state };
	}
}

/** Joins [style, text] segments, cutting the plain text to width so lines never wrap. */
function paint(segments, width, style) {
	let left = width;
	let out = "";
	for (const [name, text] of segments) {
		if (left <= 0) break;
		const cut = text.length > left ? `${text.slice(0, left - 1)}…` : text;
		left -= cut.length;
		out += name ? style(name, cut) : cut;
	}
	return out;
}

function itemSegments(cand, { marked, focused, pad }) {
	const suffix = cand.kind === "regex" ? SUBDOMAINS : "";
	const target = `${cand.target}${suffix}`;
	const details = [cand.label, `${cand.requests} req`]
		.filter(Boolean)
		.join(" · ");
	return [
		[focused ? "cyan" : "", focused ? "❯ " : "  "],
		[marked ? "green" : "", marked ? "[x] " : "[ ] "],
		[focused ? "bold" : "", cand.target],
		["dim", suffix],
		["", " ".repeat(Math.max(1, pad - target.length + 2))],
		["dim", details],
	];
}

function detailLines(row, state, items) {
	if (row.type === "item") {
		const { cand } = row;
		const lines = [...cand.reasons];
		if (cand.hosts.length > 1 || cand.hosts[0] !== cand.target)
			lines.push(`hosts: ${cand.hosts.join(", ")}`);
		return lines;
	}
	const names = (set) =>
		items
			.filter((c) => set.has(c.n))
			.map((c) => c.target)
			.join(", ");
	if (row.action === "selected")
		return [
			state.selected.size
				? `will block: ${names(state.selected)}`
				: "nothing is marked",
		];
	if (row.action === "recommended") {
		const rec = recommended(items);
		return [rec.size ? `will block: ${names(rec)}` : "nothing is recommended"];
	}
	return ["leave Pi-hole unchanged"];
}

/**
 * Draws the menu for a terminal of `columns` × `height` → { lines, offset }.
 * The candidate list scrolls (offset) while the actions and details stay visible.
 */
export function renderMenu(
	rows,
	state,
	{ columns = 80, height = 24, style = plain } = {},
) {
	const width = Math.max(20, columns - 1);
	const items = itemsOf(rows);
	const separatorAt = rows.findIndex((r) => r.type === "separator");
	const list = rows.slice(0, separatorAt);
	const pad = targetWidth(items);
	const DETAILS = 3;
	// Title, a marker line above and below the list, separator + actions, blank + details, spare.
	const size = Math.max(3, height - 1 - 2 - 4 - (1 + DETAILS) - 1);

	let offset = Math.min(state.offset, Math.max(0, list.length - size));
	if (state.cursor < separatorAt) {
		// Show a group's header together with its first candidate.
		const top =
			list[state.cursor - 1]?.type === "header"
				? state.cursor - 1
				: state.cursor;
		if (top < offset) offset = top;
		if (state.cursor >= offset + size) offset = state.cursor - size + 1;
	}
	const visible = list.slice(offset, offset + size);

	const lines = [
		paint(
			[
				["bold", "Block which?  "],
				["dim", HELP],
			],
			width,
			style,
		),
	];
	lines.push(
		offset > 0 ? paint([["dim", `  ↑ ${offset} more`]], width, style) : "",
	);
	visible.forEach((row, i) => {
		const index = offset + i;
		if (row.type === "header")
			lines.push(paint([["bold", GROUP_TITLES[row.group]]], width, style));
		else
			lines.push(
				paint(
					itemSegments(row.cand, {
						marked: state.selected.has(row.cand.n),
						focused: index === state.cursor,
						pad,
					}),
					width,
					style,
				),
			);
	});
	const below = list.length - offset - visible.length;
	if (below > 0)
		lines.push(paint([["dim", `  ↓ ${below} more`]], width, style));
	lines.push(
		paint([["dim", `  ${"─".repeat(Math.min(width - 2, 60))}`]], width, style),
	);
	for (const [i, row] of rows.entries()) {
		if (row.type !== "action") continue;
		const focused = i === state.cursor;
		const count =
			row.action === "selected"
				? ` (${state.selected.size})`
				: row.action === "recommended"
					? ` (${recommended(items).size})`
					: "";
		lines.push(
			paint(
				[
					[focused ? "cyan" : "", focused ? "❯ " : "  "],
					[focused ? "bold" : "", `▸ ${ACTION_LABELS[row.action]}${count}`],
				],
				width,
				style,
			),
		);
	}
	lines.push("");
	const details = detailLines(rows[state.cursor], state, items).slice(
		0,
		DETAILS,
	);
	for (const text of details)
		lines.push(paint([["dim", `  ${text}`]], width, style));
	return { lines, offset };
}

/** The list as it ends up: every candidate with the marks that were actually applied. */
export function renderFinal(
	rows,
	result,
	{ columns = 80, style = plain } = {},
) {
	const width = Math.max(20, columns - 1);
	const chosen = new Set(result.map((c) => c.n));
	const items = itemsOf(rows);
	const pad = targetWidth(items);
	const lines = [];
	for (const row of rows) {
		if (row.type === "header")
			lines.push(paint([["bold", GROUP_TITLES[row.group]]], width, style));
		if (row.type === "item")
			lines.push(
				paint(
					itemSegments(row.cand, {
						marked: chosen.has(row.cand.n),
						focused: false,
						pad,
					}),
					width,
					style,
				),
			);
	}
	return lines;
}

/**
 * Lets the user pick candidates with the arrow keys and space → the candidates to block.
 * Needs a TTY; the caller falls back to typed input otherwise.
 */
export function selectCandidates(
	scan,
	{ stdin = process.stdin, stdout = process.stdout, style = plain } = {},
) {
	const rows = menuRows(scan.candidates);
	let state = initialState(rows);
	let drawn = 0;
	const clear = () => {
		moveCursor(stdout, 0, -drawn);
		cursorTo(stdout, 0);
		clearScreenDown(stdout);
		drawn = 0;
	};
	const draw = () => {
		const { lines, offset } = renderMenu(rows, state, {
			columns: stdout.columns,
			height: stdout.rows,
			style,
		});
		state = { ...state, offset };
		clear();
		stdout.write(lines.join("\n"));
		drawn = lines.length - 1;
	};

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			stdin.off("keypress", onKeypress);
			stdout.off?.("resize", draw);
			restoreTerminal(stdin);
			clear();
			stdout.write(SHOW_CURSOR);
		};
		const onKeypress = (_text, key) => {
			try {
				const next = onKey(rows, state, key);
				if (!next.result) {
					state = next.state;
					return draw();
				}
				cleanup();
				const final = renderFinal(rows, next.result, {
					columns: stdout.columns,
					style,
				});
				stdout.write(`${final.join("\n")}\n`);
				resolve(next.result);
			} catch (e) {
				cleanup();
				reject(e);
			}
		};
		emitKeypressEvents(stdin);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("keypress", onKeypress);
		stdout.on?.("resize", draw);
		stdout.write(HIDE_CURSOR);
		draw();
	});
}
