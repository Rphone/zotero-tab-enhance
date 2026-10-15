import hooks from "../../src/hooks";
import { createZToolkit } from "../../src/utils/ztoolkit";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

describe("shared toolkit lifecycle", function () {
  let originalGlobals: {
    Zotero: typeof Zotero;
    addon: typeof addon;
    ztoolkit: typeof ztoolkit;
    Services: typeof Services;
  };
  let windows: _ZoteroTypes.MainWindow[];
  let globalRegistrations: number;

  beforeEach(function () {
    originalGlobals = {
      Zotero: globalThis.Zotero,
      addon: globalThis.addon,
      ztoolkit: globalThis.ztoolkit,
      Services: globalThis.Services,
    };
    globalRegistrations = 0;
    windows = [0, 1].map(
      () =>
        ({
          document: {},
          MozXULElement: { insertFTLIfNeeded: () => undefined },
          addEventListener: () => globalRegistrations++,
          removeEventListener: () => undefined,
        }) as unknown as _ZoteroTypes.MainWindow,
    );
    class Item {
      getField() {
        return "title";
      }
      setField() {}
      isFieldOfBase() {
        return false;
      }
    }
    Object.assign(globalThis, {
      Zotero: {
        Item,
        Utilities: { randomString: () => "test" },
        Reader: {
          registerEventListener: () => globalRegistrations++,
          _readers: [],
        },
        Plugins: {
          addObserver: () => globalRegistrations++,
          removeObserver: () => undefined,
        },
        getMainWindow: () => windows[0],
        getMainWindows: () => windows,
        Prefs: { get: () => false },
        debug: () => undefined,
        logError: () => undefined,
        _toolkitGlobal: {
          currentWindow: windows[0],
          prompt: { _ready: true, instance: { commands: [] } },
        },
      },
      Services: {
        wm: {
          addListener: () => globalRegistrations++,
          removeListener: () => undefined,
        },
      },
    });
    const toolkit = createZToolkit();
    Object.assign(globalThis, {
      ztoolkit: toolkit,
      addon: {
        data: {
          config: { addonRef: "test", addonInstance: "test", alive: true },
          ztoolkit: toolkit,
        },
        tabTrackerInstances: new Map(),
        verticalTabSidebarInstances: new Map(),
        itemMenuEnhanceInstances: new Map(),
        tabEnhanceInstances: new Map(),
      },
    });
  });

  afterEach(function () {
    Object.assign(globalThis, originalGlobals);
  });

  it("constructs and cleans up without wrapping item methods or installing global listeners", function () {
    const getField = Zotero.Item.prototype.getField;
    const setField = Zotero.Item.prototype.setField;
    const isFieldOfBase = Zotero.Item.prototype.isFieldOfBase;
    const toolkit = createZToolkit();
    toolkit.unregisterAll();
    assert(
      Zotero.Item.prototype.getField === getField &&
        Zotero.Item.prototype.setField === setField &&
        Zotero.Item.prototype.isFieldOfBase === isFieldOfBase,
      "expected native item methods to remain unchanged",
    );
    assert(
      globalRegistrations === 0,
      "expected no unused keyboard, reader, or window observers",
    );
  });

  it("reuses the existing toolkit when loading multiple windows", async function () {
    const toolkit = addon.data.ztoolkit;
    await hooks.onMainWindowLoad(windows[0]);
    await hooks.onMainWindowLoad(windows[1]);
    assert(addon.data.ztoolkit === toolkit, "expected one shared toolkit");
    assert(globalRegistrations === 0, "expected no manager registrations");
  });

  it("only destroys the closing window's features and leaves shared cleanup to shutdown", async function () {
    let globalCleanups = 0;
    let closedWindowCleanups = 0;
    let otherWindowCleanups = 0;
    addon.data.ztoolkit.unregisterAll = () => globalCleanups++;
    for (const instances of [
      addon.tabTrackerInstances,
      addon.verticalTabSidebarInstances,
      addon.itemMenuEnhanceInstances,
      addon.tabEnhanceInstances,
    ]) {
      const features = instances as Map<Window, { destroy: () => void }>;
      features.set(windows[0], { destroy: () => closedWindowCleanups++ });
      features.set(windows[1], { destroy: () => otherWindowCleanups++ });
    }
    await hooks.onMainWindowUnload(windows[0]);
    assert(closedWindowCleanups === 4, "expected closing window cleanup");
    assert(otherWindowCleanups === 0, "expected other window features intact");
    assert(globalCleanups === 0, "expected shared resources to remain active");
    hooks.onShutdown();
    assert(otherWindowCleanups === 4, "expected remaining features cleaned up");
    assert(globalCleanups === 1, "expected one global cleanup at shutdown");
  });
});
