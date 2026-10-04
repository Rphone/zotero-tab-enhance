import {
  restoreSidebarState,
  sanitizeGroups,
} from "../../src/modules/verticalTabs/sidebarPersistence";
import { VirtualGroup } from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("sidebarPersistence", function () {
  let originalGlobals: { Zotero: typeof Zotero; addon: typeof addon };
  let savedGroups: string | null;
  let loadedIDs: Set<number>;
  let requestedIDs: number[][];
  let loadedDataIDs: number[];

  beforeEach(function () {
    originalGlobals = { Zotero: globalThis.Zotero, addon: globalThis.addon };
    savedGroups = null;
    loadedIDs = new Set();
    requestedIDs = [];
    loadedDataIDs = [];
    Object.assign(globalThis, {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: () => [
                { value: "New Group", attributes: null },
              ],
            },
          },
        },
      },
      Zotero: {
        Items: {
          exists: (id: number) => id >= 1 && id <= 5,
          get: (id: number) => {
            if (id === 99) return false;
            if (!loadedIDs.has(id))
              throw new Error(`Item ${id} not yet loaded`);
            return { id };
          },
          getAsync: async (ids: number[]) => {
            requestedIDs.push(ids);
            ids.forEach((id) => loadedIDs.add(id));
            return ids.map((id) => ({
              id,
              parentItemID: id === 3 ? 4 : null,
            }));
          },
          loadDataTypes: async (items: Array<{ id: number }>) => {
            loadedDataIDs = items.map((item) => item.id);
          },
        },
        Prefs: {
          get: (key: string) =>
            key.endsWith(".verticalTabs.groups") ? savedGroups : null,
          set: () => {
            throw new Error("restoration must not write preferences");
          },
        },
      },
    });
  });

  afterEach(function () {
    Object.assign(globalThis, originalGlobals);
  });

  it("drops duplicate groups and unresolved members", function () {
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

  it("normalizes existing members without reading the unloaded item cache", function () {
    const groups = sanitizeGroups([makeGroup()]);
    assert(groups.length === 1, "expected the existing group to survive");
    assert(
      groups[0].members[0].itemID === 1,
      "expected the unloaded member to survive",
    );
  });

  it("waits for closed members, parents, and display metadata", async function () {
    savedGroups = JSON.stringify([makeGroup()]);
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    Object.assign(Zotero.Items, {
      loadDataTypes: async (items: Array<{ id: number }>) => {
        await loading;
        loadedDataIDs = items.map((item) => item.id);
      },
    });
    let restored = false;
    const pending = restoreSidebarState().then((state) => {
      restored = true;
      return state;
    });
    await Promise.resolve();
    assert(!restored, "expected metadata loading to finish before restoration");
    finishLoading();
    const state = await pending;

    assert(state.groups.length === 1, "expected the closed group to restore");
    assert(
      !state.groups[0].members[0].isOpen,
      "expected the member to remain closed",
    );
    assert(
      JSON.stringify(requestedIDs) === JSON.stringify([[1, 2]]),
      "expected one deduplicated member and parent load",
    );
    assert(
      loadedDataIDs.includes(1) && loadedDataIDs.includes(2),
      "expected both member and parent display metadata",
    );
  });

  it("loads current tabs and discovers parents absent from saved state", async function () {
    savedGroups = JSON.stringify([makeGroup()]);
    await restoreSidebarState([
      { itemID: 1, parentItemID: 2 },
      { itemID: 3, parentItemID: null },
    ]);

    assert(
      JSON.stringify(requestedIDs) === JSON.stringify([[1, 2, 3], [4]]),
      "expected current tabs and their newly discovered parents",
    );
    assert(
      loadedDataIDs.includes(4),
      "expected display metadata for the discovered parent",
    );
  });

  it("restores a closed note's parent when it was absent from saved state", async function () {
    const group = makeGroup();
    Object.assign(group.members[0], {
      type: "note-unloaded",
      itemID: 3,
      parentItemID: null,
      key: "item:3",
    });
    savedGroups = JSON.stringify([group]);
    const state = await restoreSidebarState();
    assert(
      state.groups[0].members[0].parentItemID === 4,
      "expected the loaded parent to be available for closed-note display",
    );
    assert(
      state.groups[0].members[0].key === "item:3",
      "expected the note's own identity to be preserved",
    );
  });

  for (const method of ["getAsync", "loadDataTypes"]) {
    it(`preserves saved JSON when ${method} fails`, async function () {
      savedGroups = JSON.stringify([makeGroup()]);
      const originalJSON = savedGroups;
      Object.assign(Zotero.Items, {
        [method]: async () => {
          throw new Error("load failed");
        },
      });
      let failed = false;
      try {
        await restoreSidebarState();
      } catch {
        failed = true;
      }
      assert(failed, "expected loading failure to reach the lifecycle handler");
      assert(savedGroups === originalJSON, "expected saved groups unchanged");
    });
  }

  it("cleans genuinely deleted members without loading missing items", async function () {
    savedGroups = JSON.stringify([makeGroup()]);
    Object.assign(Zotero.Items, { exists: () => false });
    const state = await restoreSidebarState();
    assert(state.groups.length === 0, "expected deleted members to be removed");
    assert(requestedIDs.length === 0, "expected no lookup of missing items");
  });

  for (const invalid of ["{", "null", "{}"]) {
    it(`rejects invalid saved groups without replacing them: ${invalid}`, async function () {
      savedGroups = invalid;
      let failed = false;
      try {
        await restoreSidebarState();
      } catch {
        failed = true;
      }
      assert(failed, "expected invalid saved groups to be rejected");
      assert(savedGroups === invalid, "expected the original JSON unchanged");
    });
  }
});

function makeGroup(): VirtualGroup {
  return {
    id: "group-1",
    name: "Saved group",
    color: "#112233",
    collapsed: false,
    sortMode: "manual",
    members: [
      {
        id: "member-1",
        key: "item:1",
        sourceTabKey: null,
        tabId: null,
        type: "reader",
        title: "Closed PDF",
        itemID: 1,
        parentItemID: 2,
        isOpen: false,
        openedAt: null,
        iconKey: "reader",
      },
    ],
  };
}
