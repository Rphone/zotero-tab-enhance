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

  it("filters grouped tabs when member and tab keys are equivalent aliases", () => {
    const groupedTab = makeTab({
      key: "tab:reader-attachment",
      tabId: "reader-attachment",
      type: "reader",
      itemID: 10,
      parentItemID: 100,
      nativeIndex: 0,
    });
    const ungroupedTab = makeTab({
      key: "tab:other",
      tabId: "other",
      itemID: 20,
      parentItemID: 200,
      nativeIndex: 1,
    });
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        members: [
          makeMember({
            key: "item:100",
            tabId: null,
            itemID: null,
            parentItemID: 100,
            type: "reader-unloaded",
            isOpen: false,
          }),
        ],
      }),
    ]);

    const ungroupedTabs = store.getUngroupedTabs([groupedTab, ungroupedTab]);

    assert(ungroupedTabs.length === 1, "expected one ungrouped tab");
    assert(
      ungroupedTabs[0].key === "tab:other",
      "expected alias-matched grouped tab to be hidden",
    );
  });

  it("creates one group containing all requested tabs", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    const firstTab = makeTab({
      key: "tab:1",
      tabId: "1",
      itemID: 1,
      nativeIndex: 0,
      title: "First",
    });
    const secondTab = makeTab({
      key: "tab:2",
      tabId: "2",
      itemID: 2,
      nativeIndex: 1,
      title: "Second",
    });

    const group = store.createGroupFromTabs([firstTab, secondTab], "Batch");

    assert(group?.name === "Batch", "expected requested group name");
    assert(group?.members.length === 2, "expected both tabs in one group");
    assert(
      JSON.stringify(group?.members.map((member) => member.key)) ===
        JSON.stringify(["item:1", "item:2"]),
      "expected group members to preserve tab order",
    );
  });

  it("keeps single-tab group creation available", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    const group = store.createGroupFromTab(
      makeTab({
        key: "tab:1",
        tabId: "1",
        itemID: 1,
      }),
      "Single",
    );

    assert(group.name === "Single", "expected single-tab group name");
    assert(group.members.length === 1, "expected only one member");
    assert(group.members[0].key === "item:1", "expected source tab member");
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

  it("moves a member before a target member in another group", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        id: "group-1",
        members: [makeMember({ id: "member-1", key: "item:1" })],
      }),
      makeGroup({
        id: "group-2",
        members: [
          makeMember({ id: "member-2", key: "item:2" }),
          makeMember({ id: "member-3", key: "item:3" }),
        ],
      }),
    ]);

    store.moveMemberToGroup("group-1", "group-2", "item:1", "item:2", "before");

    const groups = store.getGroups();
    assert(groups.length === 1, "expected empty source group to be removed");
    assert(groups[0].id === "group-2", "expected target group to remain");
    assert(
      JSON.stringify(groups[0].members.map((member) => member.key)) ===
        JSON.stringify(["item:1", "item:2", "item:3"]),
      "expected moved member before target member",
    );
  });

  it("moves a member after a target member in another group", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        id: "group-1",
        members: [
          makeMember({ id: "member-1", key: "item:1" }),
          makeMember({ id: "member-4", key: "item:4" }),
        ],
      }),
      makeGroup({
        id: "group-2",
        members: [
          makeMember({ id: "member-2", key: "item:2" }),
          makeMember({ id: "member-3", key: "item:3" }),
        ],
      }),
    ]);

    store.moveMemberToGroup("group-1", "group-2", "item:1", "item:2", "after");

    const groups = store.getGroups();
    const sourceGroup = groups.find((group) => group.id === "group-1");
    const targetGroup = groups.find((group) => group.id === "group-2");
    assert(sourceGroup?.members.length === 1, "expected source member removed");
    assert(
      JSON.stringify(targetGroup?.members.map((member) => member.key)) ===
        JSON.stringify(["item:2", "item:1", "item:3"]),
      "expected moved member after target member",
    );
  });

  it("keeps move-to-group append behavior without a target member", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        id: "group-1",
        members: [
          makeMember({ id: "member-1", key: "item:1" }),
          makeMember({ id: "member-3", key: "item:3" }),
        ],
      }),
      makeGroup({
        id: "group-2",
        members: [makeMember({ id: "member-2", key: "item:2" })],
      }),
    ]);

    store.moveMemberToGroup("group-1", "group-2", "item:1");

    const targetGroup = store
      .getGroups()
      .find((group) => group.id === "group-2");
    assert(
      JSON.stringify(targetGroup?.members.map((member) => member.key)) ===
        JSON.stringify(["item:2", "item:1"]),
      "expected move without target member to append",
    );
  });

  it("adds an ungrouped tab before a target member", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        id: "group-1",
        members: [
          makeMember({ id: "member-2", key: "item:2", itemID: 2 }),
          makeMember({ id: "member-3", key: "item:3", itemID: 3 }),
        ],
      }),
    ]);

    store.addTabToGroup(
      "group-1",
      makeTab({ key: "tab:1", tabId: "1", itemID: 1 }),
      "item:2",
      "before",
    );

    assert(
      JSON.stringify(store.getGroups()[0].members.map((member) => member.key)) ===
        JSON.stringify(["item:1", "item:2", "item:3"]),
      "expected added tab before target member",
    );
  });

  it("adds an ungrouped tab after a target member", () => {
    const store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.setGroups([
      makeGroup({
        id: "group-1",
        members: [
          makeMember({ id: "member-2", key: "item:2", itemID: 2 }),
          makeMember({ id: "member-3", key: "item:3", itemID: 3 }),
        ],
      }),
    ]);

    store.addTabToGroup(
      "group-1",
      makeTab({ key: "tab:1", tabId: "1", itemID: 1 }),
      "item:2",
      "after",
    );

    assert(
      JSON.stringify(store.getGroups()[0].members.map((member) => member.key)) ===
        JSON.stringify(["item:2", "item:1", "item:3"]),
      "expected added tab after target member",
    );
  });
});
