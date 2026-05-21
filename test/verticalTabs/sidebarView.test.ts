import SidebarViewRenderer from "../../src/modules/verticalTabs/sidebarView";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("sidebarView", () => {
  it("normalizes tabs and filters library tabs", () => {
    const renderer = new SidebarViewRenderer(
      {} as _ZoteroTypes.MainWindow,
      {} as Document,
      {
        getUngroupedTabs: (tabs: any[]) => tabs,
      } as any,
    );

    const normalized = renderer.normalizeTab({
      key: "",
      tabId: "abc",
      type: "reader",
      title: "Paper",
      itemID: null,
      parentItemID: null,
      isOpen: true,
      isSelected: false,
      nativeIndex: 1,
      openedAt: null,
      iconKey: "reader",
    });

    assert(normalized.key === "tab:abc", "expected empty key to normalize");
    assert(
      renderer.shouldRenderTab({
        ...normalized,
        tabId: "zotero-pane",
        type: "library",
      }) === false,
      "expected library tab to be filtered",
    );
  });

  it("builds recent sections in descending recency", () => {
    const renderer = new SidebarViewRenderer(
      {} as _ZoteroTypes.MainWindow,
      {} as Document,
      {
        getUngroupedTabs: (tabs: any[]) => tabs,
      } as any,
    ) as any;

    const now = Date.now();
    const sections = renderer.buildRecentSections([
      {
        key: "t1",
        tabId: "1",
        type: "reader",
        title: "Now",
        itemID: null,
        parentItemID: null,
        isOpen: true,
        isSelected: false,
        nativeIndex: 1,
        openedAt: now - 60_000,
        iconKey: "reader",
      },
      {
        key: "t2",
        tabId: "2",
        type: "reader",
        title: "Earlier",
        itemID: null,
        parentItemID: null,
        isOpen: true,
        isSelected: false,
        nativeIndex: 2,
        openedAt: now - 86_400_000 * 2,
        iconKey: "reader",
      },
    ]);

    assert(
      JSON.stringify(sections[0].tabs.map((tab: any) => tab.key)) ===
        JSON.stringify(["t1"]),
      "expected newest tab in recent-now section",
    );
    assert(
      JSON.stringify(sections[2].tabs.map((tab: any) => tab.key)) ===
        JSON.stringify(["t2"]),
      "expected older tab in recent-earlier section",
    );
  });
});
