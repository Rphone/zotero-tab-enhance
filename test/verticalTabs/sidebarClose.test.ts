import VerticalTabSidebar from "../../src/modules/verticalTabs/sidebar";
import SidebarViewRenderer, {
  SidebarRenderState,
  SidebarViewHandlers,
} from "../../src/modules/verticalTabs/sidebarView";
import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import TabTrackerService from "../../src/modules/verticalTabs/tabTracker";
import { persistGroupsState } from "../../src/modules/verticalTabs/sidebarPersistence";
import {
  TabTrackerSnapshot,
  TrackedTab,
  VirtualGroupMember,
} from "../../src/modules/verticalTabs/types";

type MemberRenderer = {
  renderGroupMemberRow: (
    member: VirtualGroupMember,
    groupId: string,
    state: SidebarRenderState,
    handlers: SidebarViewHandlers,
  ) => HTMLElement;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeMember(itemID: number, type = "reader"): VirtualGroupMember {
  return {
    id: `m${itemID}`,
    key: `item:${itemID}`,
    sourceTabKey: null,
    tabId: null,
    type,
    title: `Member ${itemID}`,
    itemID,
    parentItemID: itemID * 100,
    isOpen: false,
    openedAt: 1,
    iconKey: type.startsWith("note") ? "note" : "reader",
  };
}

describe("sidebar member close buttons", function () {
  let originalGlobals: {
    Zotero: typeof Zotero;
    addon: typeof addon;
    ztoolkit: typeof ztoolkit;
  };
  let store: TabGroupStore;
  let renderer: MemberRenderer;
  let state: SidebarRenderState;
  let handlers: SidebarViewHandlers;
  let closeCalls: Array<string | null>;
  let activations: number;
  let savedGroups: string;

  beforeEach(function () {
    originalGlobals = {
      Zotero: globalThis.Zotero,
      addon: globalThis.addon,
      ztoolkit: globalThis.ztoolkit,
    };
    closeCalls = [];
    activations = 0;
    savedGroups = "";
    Object.assign(globalThis, {
      addon: { data: {} },
      Zotero: {
        Prefs: {
          set: (_key: string, value: string) => {
            savedGroups = value;
          },
        },
      },
      ztoolkit: {
        UI: {
          createElement: (
            doc: Document,
            tag: string,
            options: {
              classList?: string[];
              properties?: Record<string, unknown>;
              attributes?: Record<string, string>;
              listeners?: Array<{ type: string; listener: EventListener }>;
            },
          ) => {
            const element = doc.createElement(tag);
            element.classList.add(...(options.classList ?? []));
            Object.assign(element, options.properties);
            for (const [name, value] of Object.entries(
              options.attributes ?? {},
            )) {
              element.setAttribute(name, value);
            }
            for (const { type, listener } of options.listeners ?? []) {
              element.addEventListener(type, listener);
            }
            return element;
          },
        },
      },
    });
    store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups(
      ["g1", "g2"].map((id) => ({
        id,
        name: id,
        color: "#112233",
        collapsed: false,
        sortMode: "manual",
        members: [makeMember(1), makeMember(2)],
      })),
    );
    renderer = new SidebarViewRenderer(
      {} as _ZoteroTypes.MainWindow,
      document,
      store,
    ) as unknown as MemberRenderer;
    state = {
      collapsed: false,
      metadataDeferred: true,
      selectedTabKey: null,
      trackedTabsByMemberKey: new Map(),
    } as SidebarRenderState;
    handlers = {
      rowClick: () => activations++,
      rowKeyDown: () => activations++,
      virtualMemberClick: () => activations++,
      virtualMemberKeyDown: () => activations++,
      closeTab: (tabId: string | null) => closeCalls.push(tabId),
      removeGroupMember: (groupId: string, memberKey: string) =>
        store.removeMember(groupId, memberKey),
    } as SidebarViewHandlers;
  });

  afterEach(function () {
    store.destroy();
    Object.assign(globalThis, originalGlobals);
  });

  function getCloseButton(row: HTMLElement): HTMLButtonElement {
    const button = row.querySelector<HTMLButtonElement>(
      ".tab-enhance-vertical-tab-close",
    );
    assert(button, "expected a close button on the member row");
    assert(button.textContent === "x", "expected the existing x button");
    return button;
  }

  for (const type of ["reader", "note", "note-unloaded"]) {
    it(`removes only the clicked closed ${type} member without reopening it`, function () {
      const member = makeMember(1, type);
      const row = renderer.renderGroupMemberRow(member, "g1", state, handlers);
      const button = getCloseButton(row);
      assert(
        button.title.endsWith("-remove-from-group"),
        "expected the existing localized remove-from-group tooltip",
      );
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(click);
      assert(click.defaultPrevented, "expected the button to handle the click");
      assert(
        store.findGroupById("g1")?.members.length === 1 &&
          store.findGroupById("g1")?.members[0].key === "item:2",
        "expected only the requested member to be removed",
      );
      assert(
        store.findGroupById("g2")?.members.length === 2,
        "expected the same member in another group to remain",
      );
      assert(
        closeCalls.length === 0 && activations === 0,
        "expected no native close or member activation",
      );
    });
  }

  it("closes an open tab first and removes its saved member on the next click", function () {
    const tab: TrackedTab = {
      key: "tab:t1",
      tabId: "t1",
      type: "reader",
      title: "Open PDF",
      itemID: 1,
      parentItemID: 100,
      isOpen: true,
      isSelected: false,
      nativeIndex: 1,
      openedAt: 1,
      iconKey: "reader",
    };
    store.syncTrackedTabs([tab]);
    state.trackedTabsByMemberKey.set("item:1", tab);
    let member = store.findGroupById("g1")!.members[0];
    const openRow = renderer.renderGroupMemberRow(
      member,
      "g1",
      state,
      handlers,
    );
    getCloseButton(openRow).click();
    assert(
      closeCalls.length === 1 && closeCalls[0] === "t1",
      "expected the native tab to close",
    );
    assert(
      store.findGroupById("g1")?.members.length === 2,
      "expected the saved member to remain after the first click",
    );

    store.syncTrackedTabs([]);
    state.trackedTabsByMemberKey.clear();
    member = store.findGroupById("g1")!.members[0];
    assert(!member.isOpen, "expected the member to become closed");
    const closedRow = renderer.renderGroupMemberRow(
      member,
      "g1",
      state,
      handlers,
    );
    getCloseButton(closedRow).click();
    assert(
      store.findGroupById("g1")?.members.length === 1 &&
        closeCalls.length === 1 &&
        activations === 0,
      "expected the second click to remove the member without reopening it",
    );
  });

  it("keeps close-button keyboard events from activating the member row", function () {
    const row = renderer.renderGroupMemberRow(
      makeMember(1),
      "g1",
      state,
      handlers,
    );
    const button = getCloseButton(row);
    for (const key of ["Enter", " "]) {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
    assert(activations === 0, "expected no keyboard-triggered reopening");
    button.click();
    assert(
      store.findGroupById("g1")?.members.length === 1,
      "expected the button action to remain usable",
    );
  });

  it("preserves the collapsed sidebar's hidden close buttons", function () {
    state.collapsed = true;
    const row = renderer.renderGroupMemberRow(
      makeMember(1),
      "g1",
      state,
      handlers,
    );
    assert(
      !row.querySelector(".tab-enhance-vertical-tab-close"),
      "expected no close button in the compact sidebar",
    );
  });

  it("wires member removal through the store and persists the empty group removal", function () {
    const sidebar = new VerticalTabSidebar(
      { document } as _ZoteroTypes.MainWindow,
      {} as TabTrackerService,
    );
    let capturedHandlers: SidebarViewHandlers | undefined;
    Object.assign(sidebar, {
      groupStore: store,
      viewRenderer: {
        render: (
          _snapshot: TabTrackerSnapshot,
          _state: SidebarRenderState,
          _elements: unknown,
          actions: SidebarViewHandlers,
        ) => {
          capturedHandlers = actions;
        },
      },
    });
    store.subscribe(() => persistGroupsState(store));
    (sidebar as unknown as { render: (s: TabTrackerSnapshot) => void }).render({
      tabs: [],
      selectedTabKey: null,
    });
    assert(capturedHandlers, "expected renderer handlers from the coordinator");
    assert(
      typeof capturedHandlers.removeGroupMember === "function",
      "expected the coordinator to supply a member-removal action",
    );
    capturedHandlers.removeGroupMember("g1", "item:1");
    capturedHandlers.removeGroupMember("g1", "item:2");
    assert(!store.findGroupById("g1"), "expected an empty group to be removed");
    assert(
      savedGroups === JSON.stringify(store.getGroups()),
      "expected the removal to be persisted through the store subscription",
    );
  });
});
