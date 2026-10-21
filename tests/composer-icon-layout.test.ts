import assert from "node:assert/strict";
import test from "node:test";
import { composerBracesGeometry } from "../client/composer-icon-layout";

test("Composer 花括号图标完整落在 16px 图标框内", () => {
  for (const hostSize of [12, 14, 16]) {
    const { size, left, top } = composerBracesGeometry(hostSize);
    assert.ok(left >= 0 && top >= 0);
    assert.ok(left + size <= 16);
    assert.ok(top + size <= 16);
  }
  assert.deepEqual(composerBracesGeometry(14), { size: 12, left: 4, top: 2 });
});
