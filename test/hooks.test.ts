import hooks from "../src/hooks";
import VerticalTabSidebar from "../src/modules/verticalTabs/sidebar";
import ItemMenuEnhance from "../src/modules/itemMenuEnhance";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

describe("awaited sidebar feature lifecycle", function () {
  let originalGlobals: { Zotero: typeof Zotero; addon: typeof addon };
  let originalInit: typeof VerticalTabSidebar.prototype.init;
  let originalDestroy: typeof VerticalTabSidebar.prototype.destroy;
  let originalMenuInit: typeof ItemMenuEnhance.prototype.init;
  let initialization: Promise<boolean>;
  let finishLoading: (ready: boolean) => void;
  let enabled: boolean;
  let menuInitializations: number;
  let destroyed: Set<VerticalTabSidebar>;
  let win: _ZoteroTypes.MainWindow;

  function startLoading() {
    initialization = new Promise<boolean>((resolve) => {
      finishLoading = resolve;
    });
  }

  beforeEach(function () {
    originalGlobals = { Zotero: globalThis.Zotero, addon: globalThis.addon };
    originalInit = VerticalTabSidebar.prototype.init;
    originalDestroy = VerticalTabSidebar.prototype.destroy;
    originalMenuInit = ItemMenuEnhance.prototype.init;
    enabled = true;
    menuInitializations = 0;
    destroyed = new Set();
    startLoading();
    win = {
      document: {},
      Zotero_Tabs: { _tabs: [], getState: () => [], selectedID: null },
    } as unknown as _ZoteroTypes.MainWindow;
    Object.assign(globalThis, {
      addon: {
        data: {},
        tabTrackerInstances: new Map(),
        verticalTabSidebarInstances: new Map(),
        itemMenuEnhanceInstances: new Map(),
        tabEnhanceInstances: new Map(),
      },
      Zotero: {
        getMainWindows: () => [win],
        Prefs: {
          get: (key: string) =>
            key.endsWith(".enableVerticalTabs") ? enabled : false,
          clear: (key: string) => {
            if (key.endsWith(".enableVerticalTabs")) enabled = false;
          },
        },
      },
    });
    VerticalTabSidebar.prototype.init = function () {
      assert(
        addon.verticalTabSidebarInstances.get(win) === this,
        "expected the pending instance registered before initialization",
      );
      return initialization;
    };
    VerticalTabSidebar.prototype.destroy = function () {
      destroyed.add(this);
    };
    ItemMenuEnhance.prototype.init = function () {
      menuInitializations += 1;
      return true;
    };
  });

  afterEach(function () {
    VerticalTabSidebar.prototype.init = originalInit;
    VerticalTabSidebar.prototype.destroy = originalDestroy;
    ItemMenuEnhance.prototype.init = originalMenuInit;
    Object.assign(globalThis, originalGlobals);
  });

  it("awaits restoration and shares the registered instance across feature syncs", async function () {
    let completed = false;
    const first = hooks.onPrefsEvent("featureToggle", {}).then(() => {
      completed = true;
    });
    const instance = addon.verticalTabSidebarInstances.get(win);
    const second = hooks.onPrefsEvent("featureToggle", {});
    await Promise.resolve();
    assert(!completed, "expected the feature event to await initialization");
    assert(
      instance === addon.verticalTabSidebarInstances.get(win),
      "expected no duplicate pending instance",
    );
    assert(menuInitializations === 0, "expected menus to wait for restoration");
    finishLoading(true);
    await Promise.all([first, second]);
    assert(menuInitializations === 1, "expected exactly one item menu");
  });

  it("discards late completion after disabling vertical tabs", async function () {
    const pending = hooks.onPrefsEvent("featureToggle", {});
    const instance = addon.verticalTabSidebarInstances.get(win)!;
    enabled = false;
    await hooks.onPrefsEvent("featureToggle", {});
    assert(
      destroyed.has(instance),
      "expected cancellation of the pending sidebar",
    );
    finishLoading(true);
    await pending;
    assert(
      addon.verticalTabSidebarInstances.size === 0 && menuInitializations === 0,
      "expected no late sidebar registration or item menu",
    );
  });

  it("allows a fresh initialization after a failed restore", async function () {
    const failed = hooks.onPrefsEvent("featureToggle", {});
    const first = addon.verticalTabSidebarInstances.get(win);
    finishLoading(false);
    await failed;
    assert(
      addon.verticalTabSidebarInstances.size === 0,
      "expected the failed instance removed",
    );
    startLoading();
    const retry = hooks.onPrefsEvent("featureToggle", {});
    assert(
      addon.verticalTabSidebarInstances.get(win) !== first,
      "expected a fresh instance for the retry",
    );
    finishLoading(true);
    await retry;
    assert(
      menuInitializations === 1,
      "expected menus after the successful retry",
    );
  });

  it("invalidates pending initialization when resetting plugin data", async function () {
    const pending = hooks.onPrefsEvent("featureToggle", {});
    const instance = addon.verticalTabSidebarInstances.get(win)!;
    await hooks.onPrefsEvent("resetPluginData", {});
    assert(destroyed.has(instance), "expected the reset to cancel loading");
    finishLoading(true);
    await pending;
    assert(
      addon.verticalTabSidebarInstances.size === 0 && menuInitializations === 0,
      "expected no stale completion after the reset",
    );
    assert(!addon.data.resettingPluginData, "expected the reset flag cleared");
  });
});
