import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { capture } from "../src/capture.js";

/** Starts a local HTTP server → { url, headers, close }. headers records each request's headers by path. */
async function serve(routes) {
	const headers = new Map();
	const server = createServer((req, res) => {
		headers.set(req.url, req.headers);
		const route = routes[req.url];
		if (!route) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, {
			"content-type": route.type,
			"access-control-allow-origin": "*",
		});
		res.end(route.body);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return { port, headers, close: () => server.close() };
}

test("capture records third-party requests and who started them (needs Chrome, Edge or Chromium)", async (t) => {
	// "localhost" and "127.0.0.1" are different hosts, so the ad server counts as a third party.
	const ads = await serve({
		"/ad.js": {
			type: "text/javascript",
			body: "fetch(new URL('/bid', document.currentScript.src));",
		},
		"/bid": { type: "application/json", body: "{}" },
	});
	const site = await serve({
		"/": {
			type: "text/html",
			body: `<title>Local news</title><script src="http://127.0.0.1:${ads.port}/ad.js"></script>`,
		},
	});
	t.after(() => {
		ads.close();
		site.close();
	});

	let cap;
	try {
		cap = await capture(`http://localhost:${site.port}/`, { wait: 0 });
	} catch (e) {
		// Locally a missing browser only skips this test; CI must have one.
		if (/No browser found/.test(e.message) && !process.env.CI)
			return t.skip("no Chrome, Edge or Chromium installed");
		throw e;
	}

	const adScript = `http://127.0.0.1:${ads.port}/ad.js`;
	const script = cap.requests.find((r) => r.url === adScript);
	assert.equal(script?.type, "script");
	assert.equal(script.sourceUrl, `http://localhost:${site.port}/`);
	const bid = cap.requests.find((r) => r.url.endsWith("/bid"));
	assert.equal(
		bid?.initiatorUrl,
		adScript,
		"initiator taken from the CDP stack",
	);
	assert.equal(cap.title, "Local news");
	assert.doesNotMatch(ads.headers.get("/ad.js")["user-agent"], /Headless/);
});
