import TabTrackerService from "../../src/modules/verticalTabs/tabTracker";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

describe("tab tracker change notifications", function () {
  let originalGlobals: { Zotero: typeof Zotero; ztoolkit: typeof ztoolkit };
  let tracker: TabTrackerService;
  let notifications: number;
  let parentReady: boolean;
  let timers: Map<number, () => void>;
  let tabs: Array<{
    id: string;
    type: string;
    title: string;
    data: { itemID: number };
  }>;
  let runtime: {
    _tabs: typeof tabs;
    selectedID: string;
    getState: () => typeof tabs;
  };

  beforeEach(function () {
    originalGlobals = {
      Zotero: globalThis.Zotero,
      ztoolkit: globalThis.ztoolkit,
    };
    notifications = 0;
    parentReady = true;
    timers = new Map();
    let timerID = 0;
    tabs = [
      { id: "t1", type: "reader", title: "One", data: { itemID: 1 } },
      { id: "t2", type: "note", title: "Two", data: { itemID: 2 } },
    ];
    runtime = { _tabs: tabs, selectedID: "t1", getState: () => tabs };
    Object.assign(globalThis, {
      ztoolkit: { log: () => {} },
      Zotero: {
        Items: {
          get: (id: number) => {
            if (!parentReady) throw new Error("Item not loaded");
            return { id, topLevelItem: { id: id + 100 } };
          },
        },
      },
    });
    tracker = new TabTrackerService({
      Zotero_Tabs: runtime,
      setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
      },
      clearTimeout: (id: number) => timers.delete(id),
    } as unknown as _ZoteroTypes.MainWindow);
    tracker.init();
    tracker.subscribe(() => notifications++);
  });

  afterEach(function () {
    tracker.destroy();
    Object.assign(globalThis, originalGlobals);
  });

  it("notifies a subscriber once and skips unchanged queued and delayed checks", function () {
    assert(notifications === 1, "expected the initial subscription snapshot");
    tracker.reconcile("unchanged");
    tracker.requestReconcile("notification burst");
    tracker.requestReconcile("same burst");
    tracker.scheduleDelayedReconcile("settle");
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    assert(
      notifications === 1,
      "expected unchanged snapshots to do no subscriber work",
    );
  });

  it("reports selection, title, type, identity, ordering, add and close changes", function () {
    const changes = [
      () => {
        runtime.selectedID = "t2";
      },
      () => {
        tabs[0].title = "Renamed";
      },
      () => {
        tabs[0].type = "reader-unloaded";
      },
      () => {
        tabs[0].data.itemID = 3;
      },
      () => {
        tabs.reverse();
      },
      () => {
        tabs.push({
          id: "t3",
          type: "note",
          title: "Three",
          data: { itemID: 4 },
        });
      },
      () => {
        tabs.pop();
      },
      () => {
        runtime.selectedID = "zotero-pane";
      },
    ];
    for (const change of changes) {
      const before = notifications;
      change();
      tracker.reconcile("changed");
      assert(
        notifications === before + 1,
        "expected changed snapshot notification",
      );
      tracker.reconcile("settled");
      assert(
        notifications === before + 1,
        "expected no duplicate notification",
      );
    }
  });

  it("reports parent metadata when a previously unloaded item becomes available", function () {
    parentReady = false;
    tabs[0].data.itemID = 20;
    tracker.reconcile("unloaded");
    assert(
      tracker.getTabs()[0].parentItemID === null,
      "expected pending metadata",
    );
    const before = notifications;
    parentReady = true;
    tracker.reconcile("loaded");
    assert(
      notifications === before + 1,
      "expected recovered metadata to notify",
    );
    assert(
      tracker.getTabs()[0].parentItemID === 120,
      "expected resolved parent",
    );
  });

  it("titles a new untitled item tab like Zotero instead of with its tab ID", function () {
    let titleLookups = 0;
    const attachment = {
      id: 5,
      topLevelItem: { id: 105 },
      attachmentFilename: "paper.pdf",
      isAttachment: () => true,
      getDisplayTitle: () => "Full Text PDF",
      parentItem: {
        getDisplayTitle: () => "Paper",
        getField: (field: string) =>
          field === "firstCreator" ? "Smith" : field === "year" ? "2020" : "",
      },
      getTabTitle: async () => {
        titleLookups++;
        return "";
      },
    };
    Object.assign(globalThis, {
      Zotero: {
        isWin: false,
        Prefs: { get: () => "titleCreatorYear" },
        Items: {
          get: (id: number) =>
            id === 5 ? attachment : { id, topLevelItem: { id: id + 100 } },
        },
      },
    });
    const newTitle = () =>
      tracker.getTabs().find((tab) => tab.tabId === "tab-new")?.title;

    tabs.push({
      id: "tab-new",
      type: "reader",
      title: "",
      data: { itemID: 5 },
    });
    tracker.reconcile("added untitled");
    assert(
      newTitle() === "Paper - Smith - 2020",
      "expected Zotero's title format while Zotero names the tab",
    );
    assert(
      titleLookups === 0,
      "expected no extra async title lookup while the reader loads",
    );

    const before = notifications;
    tabs[tabs.length - 1].title = "Paper - Smith - 2020";
    tracker.reconcile("renamed");
    assert(
      notifications === before,
      "expected Zotero's matching title to change nothing",
    );

    tabs[tabs.length - 1].title = "Supplement - Smith - 2020";
    tracker.reconcile("secondary attachment");
    assert(
      notifications === before + 1 &&
        newTitle() === "Supplement - Smith - 2020",
      "expected Zotero's own title to take precedence",
    );
  });

  it("cancels queued work and listeners on destruction", function () {
    tracker.requestReconcile("pending");
    tracker.scheduleDelayedReconcile("pending");
    tracker.destroy();
    assert(timers.size === 0, "expected all pending timers cleared");
    assert(tracker.getTabs().length === 0, "expected the snapshot cleared");
    tracker.requestReconcile("after destroy");
    assert(timers.size === 0, "expected no work after destruction");
  });
});
