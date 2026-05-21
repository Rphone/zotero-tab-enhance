import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import {
  TrackedTab,
  VirtualGroup,
  VirtualGroupMember,
} from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeTab(overrides: Partial<TrackedTab>): TrackedTab {
  return {
    key: "tab:1",
    tabId: "1",
    type: "reader",
    title: "Paper",
    itemID: 1,
    parentItemID: null,
    isOpen: true,
    isSelected: false,
    nativeIndex: 0,
    openedAt: 1,
    iconKey: "reader",
    ...overrides,
  };
}

function makeGroup(overrides: Partial<VirtualGroup>): VirtualGroup {
  return {
    id: "group-1",
    name: "Group",
    color: "#F6B433",
    collapsed: false,
    sortMode: "manual",
    members: [],
    ...overrides,
  };
}

function makeMember(
  overrides: Partial<VirtualGroupMember>,
): VirtualGroupMember {
  return {
    id: "member-1",
    key: "item:1",
    sourceTabKey: "tab:1",
    tabId: "1",
    type: "reader",
    title: "Paper",
    itemID: 1,
    parentItemID: null,
    isOpen: true,
    openedAt: 1,
    iconKey: "reader",
    ...overrides,
  };
}

describe("TabGroupStore", () => {
  beforeEach(() => {
    (globalThis as any).ztoolkit = {
      log: () => undefined,
    };
    (globalThis as any).Zotero = {
      Prefs: {
        get: () => null,
      },
    };
  });

  it("filters grouped tabs from the ungrouped tab list", () => {
    const groupedTab = makeTab({
      key: "tab:1",
      tabId: "1",
      itemID: 1,
      nativeIndex: 0,
    });
    const ungroupedTab = makeTab({
      key: "tab:2",
      tabId: "2",
      itemID: 2,
      nativeIndex: 1,
    });
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        members: [makeMember({})],
      }),
    ]);

    const ungroupedTabs = store.getUngroupedTabs([groupedTab, ungroupedTab]);

    assert(ungroupedTabs.length === 1, "expected one ungrouped tab");
    assert(
      ungroupedTabs[0].key === "tab:2",
      "expected grouped tab to be hidden",
    );
  });

  it("marks a grouped member virtual when its tracked tab closes", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        members: [makeMember({})],
      }),
    ]);

    const changed = store.syncTrackedTabs([]);
    const member = store.getGroups()[0].members[0];

    assert(changed, "expected sync to report a state change");
    assert(member.isOpen === false, "expected closed member to become virtual");
    assert(
      member.sourceTabKey === null,
      "expected closed member source key cleared",
    );
    assert(member.tabId === null, "expected closed member tab id cleared");
  });

  it("reorders groups around the requested target position", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({ id: "group-1", members: [makeMember({ id: "member-1" })] }),
      makeGroup({
        id: "group-2",
        members: [makeMember({ id: "member-2", key: "item:2" })],
      }),
      makeGroup({
        id: "group-3",
        members: [makeMember({ id: "member-3", key: "item:3" })],
      }),
    ]);

    store.reorderGroup("group-1", "group-3", "after");

    assert(
      JSON.stringify(store.getGroups().map((group) => group.id)) ===
        JSON.stringify(["group-2", "group-3", "group-1"]),
      "expected source group to move after target group",
    );
  });
});
