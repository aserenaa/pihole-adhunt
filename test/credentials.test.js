import assert from "node:assert/strict";
import { test } from "node:test";

import { readPassword } from "../src/credentials.js";

test("PIHOLE_PASSWORD wins over the keychain", () => {
	assert.equal(readPassword({ PIHOLE_PASSWORD: "from-env" }), "from-env");
});
