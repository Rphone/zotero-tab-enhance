import VerticalTabSidebar from "../../src/modules/verticalTabs/sidebar";
import TabTrackerService from "../../src/modules/verticalTabs/tabTracker";
import { VirtualGroup } from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

describe("sidebar asynchronous initialization", function () {
  let originalGlobals: { Zotero: typeof Zotero; addon: typeof addon };
  let sidebar: VerticalTabSidebar;
  let tracker: TabTrackerService;
  let finishLoading: () => void;
  let failLoading: (error: Error) => void;
  let savedGroups: string;
  let groupWrites: number;
  let stateWrites: number;
  let savedState: string;
  let mounts: number;
  let renders: number;
  let runtimeTabs: Array<{
    id: string;
    type: string;
    title: string;
    data: { itemID: number };
  }>;
  let timers: Map<number, () => void>;

  beforeEach(function () {
    originalGlobals = { Zotero: globalThis.Zotero, addon: globalThis.addon };
    groupWrites = mounts = renders = 0;
    stateWrites = 0;
    savedState = "";
    timers = new Map();
    let timerID = 0;
    const loadedIDs = new Set<number>();
    const loading = new Promise<void>((resolve, reject) => {
      finishLoading = resolve;
      failLoading = reject;
    });
    const group: VirtualGroup = {
      id: "g1",
      name: "Saved group",
      color: "#112233",
      collapsed: false,
      sortMode: "manual",
      members: [
        {
          id: "m1",
          key: "item:1",
          sourceTabKey: "tab:old",
          tabId: "old",
          type: "reader",
          title: "PDF",
          itemID: 1,
          parentItemID: 2,
          isOpen: true,
          openedAt: 1,
          iconKey: "reader",
        },
      ],
    };
    savedGroups = JSON.stringify([group]);
    Object.assign(globalThis, {
      addon: { data: {} },
      Zotero: {
        Items: {
          exists: (id: number) => id >= 1 && id <= 3,
          get: (id: number) => {
            if (!loadedIDs.has(id))
              throw new Error(`Item ${id} not yet loaded`);
            return {
              id,
              parentItemID: id === 1 ? 2 : null,
              topLevelItem: { id: id === 1 ? 2 : id },
            };
          },
          getAsync: async (ids: number[]) => {
            await loading;
            ids.forEach((id) => loadedIDs.add(id));
            return ids.map((id) => Zotero.Items.get(id));
          },
          loadDataTypes: async () => {},
        },
        Prefs: {
          get: (key: string) =>
            key.endsWith(".verticalTabs.groups") ? savedGroups : null,
          set: (key: string, value: string) => {
            if (key.endsWith(".verticalTabs.sidebarState")) {
              savedState = value;
              stateWrites += 1;
            }
            if (key.endsWith(".verticalTabs.groups")) {
              savedGroups = value;
              groupWrites += 1;
            }
          },
        },
      },
    });
    runtimeTabs = [
      { id: "t1", type: "reader", title: "PDF", data: { itemID: 1 } },
    ];
    const win = {
      document: {},
      Zotero_Tabs: {
        _tabs: runtimeTabs,
        selectedID: "t1",
        getState: () => runtimeTabs,
      },
      setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
      },
      clearTimeout: (id: number) => timers.delete(id),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as _ZoteroTypes.MainWindow;
    tracker = new TabTrackerService(win);
    tracker.init();
    sidebar = new VerticalTabSidebar(win, tracker);
    Object.assign(sidebar, {
      mountLayout: () => {
        mounts += 1;
        return true;
      },
      applySidebarWidth: () => {},
      updateViewSwitcher: () => {},
      applyDisplayStylePrefs: () => {},
      render: () => {
        renders += 1;
      },
    });
  });

  afterEach(function () {
    sidebar.destroy();
    tracker.destroy();
    Object.assign(globalThis, originalGlobals);
  });

  it("shares one pending initialization and renders only after loading", async function () {
    const pending = sidebar.init();
    assert(sidebar.init() === pending, "expected one shared initialization");
    assert(
      mounts === 0 && groupWrites === 0,
      "expected no premature mount or save",
    );
    assert(
      !sidebar.createGroupFromOpenTab("t1"),
      "expected group editing to wait for restoration",
    );
    finishLoading();
    assert(await pending, "expected initialization to succeed");
    assert(mounts === 1, "expected exactly one sidebar mount");
    assert(
      sidebar.getGroupsForContextMenu()[0].members[0].tabId === "t1",
      "expected the member to reconnect to the current tab",
    );
    for (const callback of [...timers.values()]) callback();
    assert(
      renders === 1,
      "expected the initial render without a manual toggle",
    );
    assert(
      tracker.getTabs()[0].parentItemID === 2,
      "expected parent lookup to recover after the unloaded-cache error",
    );
  });

  it("reads tabs added while restoration is pending", async function () {
    const pending = sidebar.init();
    runtimeTabs.push({
      id: "t3",
      type: "reader",
      title: "Another PDF",
      data: { itemID: 3 },
    });
    finishLoading();
    assert(await pending, "expected initialization to succeed");
    assert(tracker.getTabs().length === 2, "expected a fresh tab snapshot");
  });

  it("does not mount or overwrite groups after destruction during loading", async function () {
    const originalJSON = savedGroups;
    const pending = sidebar.init();
    sidebar.destroy();
    finishLoading();
    assert(!(await pending), "expected the destroyed initialization to stop");
    assert(mounts === 0 && groupWrites === 0, "expected no late mount or save");
    assert(savedGroups === originalJSON, "expected saved groups unchanged");
    assert(
      !(await sidebar.init()),
      "expected no resurrection after destruction",
    );
  });

  it("preserves groups and avoids mounting when loading fails", async function () {
    const originalJSON = savedGroups;
    const pending = sidebar.init();
    failLoading(new Error("load failed"));
    assert(!(await pending), "expected initialization failure to be handled");
    assert(
      mounts === 0 && groupWrites === 0,
      "expected no empty sidebar or save",
    );
    assert(savedGroups === originalJSON, "expected saved groups unchanged");
  });

  it("does not restore stale groups after reset during loading", async function () {
    const pending = sidebar.init();
    addon.data.resettingPluginData = true;
    sidebar.destroy();
    savedGroups = "[]";
    addon.data.resettingPluginData = false;
    finishLoading();
    assert(!(await pending), "expected the old initialization to stop");
    assert(
      savedGroups === "[]" && groupWrites === 0,
      "expected the reset to win",
    );
  });

  it("releases mounted theme observers exactly once when destroyed", function () {
    let cleanups = 0;
    const coordinator = sidebar as unknown as {
      assignMountedElements: (elements: { themeCleanup: () => void }) => void;
    };
    coordinator.assignMountedElements({ themeCleanup: () => cleanups++ });
    sidebar.destroy();
    sidebar.destroy();
    assert(cleanups === 1, "expected theme listeners to be released once");
  });

  it("coalesces rapid search input into one save and one render", async function () {
    finishLoading();
    await sidebar.init();
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    const beforeRenders = renders;
    const beforeWrites = stateWrites;
    const coordinator = sidebar as unknown as {
      handleSearchInput: (value: string) => void;
    };
    for (const query of ["P", "Pa", "Paper", " PAPER "]) {
      coordinator.handleSearchInput(query);
    }
    assert(
      renders === beforeRenders && stateWrites === beforeWrites,
      "expected no render or preference write inside the input handler",
    );
    assert(timers.size === 1, "expected one pending search update");
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    assert(stateWrites === beforeWrites + 1, "expected one search save");
    assert(renders === beforeRenders + 1, "expected one search render");
    assert(
      JSON.parse(savedState).searchQuery === "paper",
      "expected the latest query",
    );
  });

  it("saves the latest search and cancels delayed work on destruction", async function () {
    finishLoading();
    await sidebar.init();
    (
      sidebar as unknown as { handleSearchInput: (value: string) => void }
    ).handleSearchInput("Pending search");
    const beforeRenders = renders;
    sidebar.destroy();
    assert(
      timers.size === 0,
      "expected no search or render timers after destruction",
    );
    assert(renders === beforeRenders, "expected no late render");
    assert(
      JSON.parse(savedState).searchQuery === "pending search",
      "expected destruction to preserve the latest search",
    );
  });

  it("does not replace a focused group editor with a delayed search render", async function () {
    finishLoading();
    await sidebar.init();
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    let focused = false;
    Object.assign(sidebar, {
      focusInlineGroupNameEditor: () => {
        focused = true;
      },
    });
    const coordinator = sidebar as unknown as {
      handleSearchInput: (value: string) => void;
      beginRenameGroupEditor: (group: VirtualGroup) => void;
    };
    coordinator.handleSearchInput("Saved group");
    coordinator.beginRenameGroupEditor(sidebar.getGroupsForContextMenu()[0]);
    const focusedRenders = renders;
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    assert(focused, "expected the group name editor to receive focus");
    assert(
      renders === focusedRenders,
      "expected no delayed search render after focus",
    );
    assert(
      JSON.parse(savedState).searchQuery === "saved group",
      "expected the search saved before editing",
    );
  });

  it("persists a batch of opened items once when adding them to a group", async function () {
    finishLoading();
    await sidebar.init();
    const tab = tracker.getTabs()[0];
    Object.assign(sidebar, {
      openItemsAsTrackedTabs: async () =>
        Array.from({ length: 100 }, (_, index) => ({
          ...tab,
          key: `tab:new-${index}`,
          tabId: `new-${index}`,
          itemID: index + 100,
        })),
    });
    const beforeWrites = groupWrites;
    assert(
      await sidebar.openItemsIntoGroup([], "g1"),
      "expected the batch to be added",
    );
    assert(groupWrites === beforeWrites + 1, "expected one persisted batch");
    assert(
      sidebar.getGroupsForContextMenu()[0].members.length === 101,
      "expected all batch members and the original member",
    );
  });

  it("renders member rows immediately when expanding a lazy group", async function () {
    finishLoading();
    await sidebar.init();
    const coordinator = sidebar as unknown as {
      groupStore: { toggleCollapsed: (id: string) => void };
      requestGroupCollapsedToggle: (
        id: string,
        collapsed: boolean,
        container: HTMLDivElement,
      ) => void;
    };
    coordinator.groupStore.toggleCollapsed("g1");
    const beforeRenders = renders;
    coordinator.requestGroupCollapsedToggle("g1", true, {} as HTMLDivElement);
    assert(
      !sidebar.getGroupsForContextMenu()[0].collapsed,
      "expected expansion immediately",
    );
    assert(
      renders === beforeRenders + 1,
      "expected member creation without waiting for an animation",
    );
  });
});
