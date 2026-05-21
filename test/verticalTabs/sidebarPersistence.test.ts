import { sanitizeGroups } from "../../src/modules/verticalTabs/sidebarPersistence";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("sidebarPersistence", () => {
  beforeEach(() => {
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: () => [{ value: "New Group", attributes: null }],
          },
        },
      },
    };
    (globalThis as any).Zotero = {
      Items: {
        get: (id: number) => (id === 1 || id === 2 ? { id } : null),
      },
      Prefs: {
        get: () => null,
      },
    };
  });

  it("drops duplicate groups and unresolved members", () => {
    const groups = sanitizeGroups([
      {
        id: "group-1",
        name: "Alpha",
        color: "#112233",
        collapsed: false,
        sortMode: "manual",
        members: [
          {
            id: "member-1",
            key: "item:1",
            sourceTabKey: null,
            tabId: "t1",
            type: "reader",
            title: "A",
            itemID: 1,
            parentItemID: null,
            isOpen: true,
            openedAt: 1,
            iconKey: "reader",
          },
          {
            id: "member-2",
            key: "item:99",
            sourceTabKey: null,
            tabId: null,
            type: "reader",
            title: "Missing",
            itemID: 99,
            parentItemID: null,
            isOpen: false,
            openedAt: null,
            iconKey: "reader",
          },
        ],
      },
      {
        id: "group-1",
        name: "Duplicate",
        color: "#445566",
        collapsed: false,
        sortMode: "manual",
        members: [],
      },
    ] as any);

    assert(groups.length === 1, "expected duplicate group to be removed");
    assert(
      groups[0].members.length === 1,
      "expected unresolved member to be removed",
    );
    assert(
      groups[0].members[0].key === "item:1",
      "expected surviving member key to be preserved",
    );
  });
});
