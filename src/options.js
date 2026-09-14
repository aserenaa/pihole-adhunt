/** "r 3 5-7" → candidates from the scan. r = recommended, n = nothing. */
export function parseSelection(tokens, scan) {
	const picked = new Map();
	for (const tok of tokens.flatMap((t) => t.split(/[\s,]+/)).filter(Boolean)) {
		if (/^(r|rec|recommended|y|yes)$/i.test(tok)) {
			for (const x of scan.candidates) if (x.preselected) picked.set(x.n, x);
		} else if (/^\d+(-\d+)?$/.test(tok)) {
			const [a, b = a] = tok.split("-").map(Number);
			if (a > b) throw new Error(`"${tok}" is a backwards range.`);
			for (let n = a; n <= b; n++) {
				const cand = scan.candidates.find((x) => x.n === n);
				if (!cand) throw new Error(`There is no number ${n} in the last scan.`);
				picked.set(n, cand);
			}
		} else if (!/^(n|no|none)$/i.test(tok)) {
			throw new Error(
				`Didn't understand "${tok}". Use r, numbers (1 3 5-7) or n.`,
			);
		}
	}
	return [...picked.values()];
}

/** A whole-number option such as `--wait 30`, between 1 and max. */
export function wholeNumber(value, flag, { fallback, max }) {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!/^\d+$/.test(value) || n < 1 || n > max)
		throw new Error(
			`${flag} must be a whole number from 1 to ${max} (got "${value}").`,
		);
	return n;
}

/**
 * "pi.hole" → "http://pi.hole"; "http://192.0.2.53/admin/" → "http://192.0.2.53". The API lives next
 * to the web interface, so a pasted /admin path is dropped; a reverse-proxy prefix is kept.
 */
export function piholeUrl(input) {
	let url;
	try {
		url = new URL(input.includes("://") ? input : `http://${input}`);
	} catch {
		throw new Error(`"${input}" is not a valid Pi-hole URL.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error(
			`The Pi-hole URL must use http:// or https:// (got "${input}").`,
		);
	const prefix = url.pathname
		.replace(/\/admin(\/.*)?$/i, "")
		.replace(/\/+$/, "");
	return `${url.origin}${prefix}`;
}

/** "example.com" → "https://example.com/". Only http(s) pages can be scanned. */
export function pageUrl(input) {
	let url;
	try {
		url = new URL(input.includes("://") ? input : `https://${input}`);
	} catch {
		throw new Error(`"${input}" is not a valid URL.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error(`Only http(s) pages can be scanned (got "${input}").`);
	return url.href;
}
