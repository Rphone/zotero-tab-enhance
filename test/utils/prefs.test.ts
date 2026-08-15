import {
  getVerticalTabStylePrefs,
  normalizeVerticalTabStylePrefValue,
} from "../../src/utils/prefs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("vertical tab style preferences", function () {
  beforeEach(function () {
    (globalThis as any).ztoolkit = {
      log: () => undefined,
    };
    (globalThis as any).Zotero = {
      Prefs: {
        get: (key: string) => {
          if (key.endsWith("verticalTabRowHeight")) {
            return 12;
          }
          if (key.endsWith("verticalTabFontSize")) {
            return 99;
          }
          return null;
        },
      },
    };
  });

  it("clamps values to the configured bounds", function () {
    assert(
      normalizeVerticalTabStylePrefValue("verticalTabRowHeight", 12) === 32,
      "expected row height lower bound",
    );
    assert(
      normalizeVerticalTabStylePrefValue("verticalTabFontSize", 99) === 24,
      "expected font size upper bound",
    );
    assert(
      normalizeVerticalTabStylePrefValue("verticalTabFontSize", "invalid") ===
        13,
      "expected invalid font size to use the default",
    );
  });

  it("returns normalized runtime style preferences", function () {
    const prefs = getVerticalTabStylePrefs();
    assert(prefs.rowHeight === 32, "expected normalized row height");
    assert(prefs.fontSize === 24, "expected normalized font size");
  });
});
