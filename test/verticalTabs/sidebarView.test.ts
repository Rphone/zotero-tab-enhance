import SidebarViewRenderer, {
  SidebarRenderState,
  SidebarViewHandlers,
  scrollTabRowIntoView,
} from "../../src/modules/verticalTabs/sidebarView";
import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import { TrackedTab, VirtualGroup } from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("sidebarView", () => {
  it("places the new-group editor after groups and before ungrouped tabs", function () {
    const groupNode = {} as HTMLElement;
    const editorNode = {} as HTMLElement;
    const tabNode = {} as HTMLElement;
    const children: HTMLElement[] = [];
    const tab = { key: "tab:1", type: "reader" } as TrackedTab;
    const renderer = new SidebarViewRenderer(
      {} as _ZoteroTypes.MainWindow,
      {} as Document,
      {
        getUngroupedTabs: () => [tab],
      } as unknown as TabGroupStore,
    );
    Object.assign(renderer, {
      getRenderableGroups: () => [{ group: { id: "existing" }, members: [] }],
      getViewTitle: () => "Tabs",
      renderGroupSection: () => groupNode,
      renderCreateGroupEditor: () => editorNode,
      renderTabRow: () => tabNode,
    });

    renderer.render(
      { tabs: [tab], selectedTabKey: null },
      {
        viewMode: "default",
        searchQuery: "",
        groupNameEditor: {
          kind: "create",
          sourceTabs: [tab],
          value: "New group",
        },
      } as SidebarRenderState,
      {
        listContainer: {
          appendChild: (child: HTMLElement) => children.push(child),
        } as unknown as HTMLElement,
        countBadge: {} as HTMLElement,
        headerTitle: {} as HTMLElement,
      },
      {
        hideContextMenu: () => {},
        updateViewSwitcher: () => {},
      } as SidebarViewHandlers,
    );

    assert(
      children.length === 3,
      "expected a group, editor, and ungrouped tab",
    );
    assert(children[0] === groupNode, "expected existing groups to stay first");
    assert(
      children[1] === editorNode,
      "expected editor at the saved group position",
    );
    assert(
      children[2] === tabNode,
      "expected source tabs below the new header",
    );
  });

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

  it("scrolls the matching tab row into the visible area", function () {
    let scrollOptions: ScrollIntoViewOptions | null = null;
    const rows = [
      {
        dataset: { tabKey: "tab:1" },
        scrollIntoView: () => {
          throw new Error("unexpected non-matching row scroll");
        },
      },
      {
        dataset: { tabKey: "tab:2" },
        scrollIntoView: (options: ScrollIntoViewOptions) => {
          scrollOptions = options;
        },
      },
    ];
    const listContainer = {
      querySelectorAll: () => ({
        length: rows.length,
        item: (index: number) => rows[index],
      }),
    } as unknown as HTMLElement;

    const scrolled = scrollTabRowIntoView(listContainer, "tab:2");

    assert(scrolled, "expected the matching row to be scrolled");
    assert(
      scrollOptions?.block === "nearest" && scrollOptions.inline === "nearest",
      "expected minimal vertical and horizontal scrolling",
    );
  });

  describe("sidebarView render costs", function () {
    let originalGlobals: {
      addon: typeof addon;
      ztoolkit: typeof ztoolkit;
      Zotero: typeof Zotero;
    };
    let renderer: SidebarViewRenderer;
    let group: VirtualGroup;
    let state: SidebarRenderState;
    let created: Array<{ classes: string[]; textContent?: string }>;
    let recordedElements: number;

    beforeEach(function () {
      originalGlobals = {
        addon: globalThis.addon,
        ztoolkit: globalThis.ztoolkit,
        Zotero: globalThis.Zotero,
      };
      created = [];
      recordedElements = 0;
      Object.assign(globalThis, {
        addon: { data: {} },
        Zotero: { Prefs: { get: () => null } },
        ztoolkit: {
          UI: {
            createElement: (
              _document: Document,
              _tag: string,
              options: {
                enableElementRecord?: boolean;
                classList?: string[];
                properties?: Record<string, unknown>;
              },
            ) => {
              if (options.enableElementRecord !== false) recordedElements += 1;
              const styles = new Map<string, string>();
              const node = {
                classes: options.classList ?? [],
                dataset: {},
                classList: { add: () => {}, toggle: () => {} },
                style: {
                  setProperty: (name: string, value: string) =>
                    styles.set(name, value),
                  getPropertyValue: (name: string) => styles.get(name) ?? "",
                },
                appendChild: () => {},
                addEventListener: () => {},
                setAttribute: () => {},
                ...options.properties,
              };
              created.push(node);
              return node;
            },
          },
        },
      });
      group = {
        id: "g1",
        name: "Saved papers",
        color: "#112233",
        collapsed: true,
        sortMode: "manual",
        members: Array.from({ length: 1000 }, (_, index) => ({
          id: `m${index}`,
          key: `item:${index}`,
          sourceTabKey: null,
          tabId: null,
          type: "reader",
          title: index === 0 ? "Needle paper" : `Paper ${index}`,
          itemID: null,
          parentItemID: null,
          isOpen: false,
          openedAt: 1,
          iconKey: "reader",
        })),
      };
      renderer = new SidebarViewRenderer(
        {} as _ZoteroTypes.MainWindow,
        {} as Document,
        {
          getGroups: () => [group],
          getUngroupedTabs: () => [],
        } as unknown as TabGroupStore,
      );
      state = {
        collapsed: false,
        viewMode: "default",
        searchQuery: "",
        trackedTabsByMemberKey: new Map(),
      } as SidebarRenderState;
    });

    afterEach(function () {
      Object.assign(globalThis, originalGlobals);
    });

    function render() {
      created = [];
      renderer.render(
        { tabs: [], selectedTabKey: null },
        state,
        {
          listContainer: { appendChild: () => {} } as unknown as HTMLElement,
          countBadge: {} as HTMLElement,
          headerTitle: {} as HTMLElement,
        },
        {
          hideContextMenu: () => {},
          updateViewSwitcher: () => {},
        } as SidebarViewHandlers,
      );
    }

    function nodesWithClass(name: string) {
      return created.filter((node) => node.classes.includes(name));
    }

    it("does not create hidden member rows or metadata for a collapsed group", function () {
      Object.assign(renderer, {
        getDisplayTitle: () => {
          throw new Error("collapsed rows must not resolve metadata");
        },
      });
      render();
      assert(
        nodesWithClass("tab-enhance-vertical-tab-row").length === 0,
        "expected no member rows for 1000 hidden members",
      );
      assert(
        created.length === 7,
        "expected only the group shell to be created",
      );
      assert(
        nodesWithClass("tab-enhance-vertical-group-count")[0].textContent ===
          "1000",
        "expected the full saved-member count",
      );
    });

    it("keeps member search and renders matching rows when the group expands", function () {
      state.searchQuery = "needle";
      render();
      assert(
        nodesWithClass("tab-enhance-vertical-group").length === 1 &&
          nodesWithClass("tab-enhance-vertical-tab-row").length === 0,
        "expected a collapsed group whose stored member matches the search",
      );
      group.collapsed = false;
      render();
      assert(
        nodesWithClass("tab-enhance-vertical-tab-row").length === 1,
        "expected only the matching member after expansion",
      );
      assert(
        nodesWithClass("tab-enhance-vertical-group-count")[0].textContent ===
          "1000",
        "expected search to preserve the full group count",
      );
      state.searchQuery = "absent phrase";
      render();
      assert(
        nodesWithClass("tab-enhance-vertical-group").length === 0,
        "expected a group without a matching name or member to stay filtered out",
      );
    });

    it("does not add disposable render nodes to the toolkit's element record", function () {
      group.members = group.members.slice(0, 2);
      group.collapsed = false;
      for (let index = 0; index < 5; index += 1) render();
      state.groupNameEditor = {
        kind: "rename",
        groupId: group.id,
        value: "Name",
      };
      render();
      state.groupNameEditor = { kind: "create", sourceTabs: [], value: "Name" };
      render();
      state.groupNameEditor = null;
      state.searchQuery = "absent phrase";
      render();
      assert(
        recordedElements === 0,
        "expected the sidebar-owned render tree to avoid accumulating toolkit records",
      );
    });
  });
});
