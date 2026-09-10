import VerticalTabSidebar from "../../src/modules/verticalTabs/sidebar";
import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import SidebarViewRenderer from "../../src/modules/verticalTabs/sidebarView";
import { InlineGroupNameEditor } from "../../src/modules/verticalTabs/sidebarCommon";
import { TrackedTab } from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

type CreateSidebar = {
  groupNameEditor: InlineGroupNameEditor | null;
  searchQuery: string;
  createGroupFromUngroupedTabs: () => void;
  commitInlineGroupNameEditor: () => void;
  cancelInlineGroupNameEditor: () => void;
};

describe("sidebar immediate group creation", function () {
  let originalGlobals: { Zotero: typeof Zotero; addon: typeof addon };
  let store: TabGroupStore;
  let sidebar: CreateSidebar;
  let tabs: TrackedTab[];
  let focused: boolean;
  let scrolled: boolean;
  let selected: boolean;
  let searchInput: { value: string };

  beforeEach(function () {
    originalGlobals = { Zotero: globalThis.Zotero, addon: globalThis.addon };
    Object.assign(globalThis, {
      Zotero: { Prefs: { get: () => null } },
      addon: { data: {} },
    });
    focused = scrolled = selected = false;
    searchInput = { value: "filtered" };
    tabs = [1, 2, 3].map((id) => ({
      key: `tab:${id}`,
      tabId: String(id),
      type: "reader",
      title: `Paper ${id}`,
      itemID: id,
      parentItemID: null,
      isOpen: true,
      isSelected: false,
      nativeIndex: id,
      openedAt: null,
      iconKey: "reader",
    }));
    store = new TabGroupStore({} as _ZoteroTypes.MainWindow);
    store.createGroupFromTab(tabs[0], "Existing");
    sidebar = Object.assign(Object.create(VerticalTabSidebar.prototype), {
      groupStore: store,
      viewRenderer: new SidebarViewRenderer(
        {} as _ZoteroTypes.MainWindow,
        {} as Document,
        store,
      ),
      groupNameEditor: null,
      collapsed: false,
      viewMode: "default",
      searchQuery: "filtered",
      searchInput,
      tracker: {
        getTabs: () => tabs,
        getSnapshot: () => ({ tabs, selectedTabKey: null }),
      },
      hideContextMenu: () => {},
      clearDragState: () => {},
      persistSidebarState: () => {},
      render: () => {
        assert(
          store.getGroups().length === 2,
          "expected a real group before rendering",
        );
        assert(
          store.getGroups()[1].members.length === 2,
          "expected members inside the group before rendering",
        );
        assert(
          store.getUngroupedTabs(tabs).length === 0,
          "expected no duplicate ungrouped rows",
        );
      },
      window: { setTimeout: (callback: () => void) => callback() },
      listContainer: {
        querySelector: () => ({
          closest: () => ({
            scrollIntoView: () => {
              scrolled = true;
            },
          }),
          focus: (options: FocusOptions) => {
            assert(
              scrolled,
              "expected the group header to scroll before focus",
            );
            assert(
              options.preventScroll,
              "expected focus without another scroll",
            );
            focused = true;
          },
          select: () => {
            selected = true;
          },
        }),
      },
    }) as CreateSidebar;
  });

  afterEach(function () {
    Object.assign(globalThis, originalGlobals);
  });

  it("groups tabs first, then focuses the actual group name and renames in place", function () {
    sidebar.createGroupFromUngroupedTabs();
    const created = store.getGroups()[1];
    assert(
      !created.collapsed,
      "expected the new group's members to be expanded",
    );
    assert(focused && selected, "expected the name to be focused and selected");
    assert(
      sidebar.searchQuery === "" && searchInput.value === "",
      "expected all new members to be visible",
    );
    assert(
      sidebar.groupNameEditor?.kind === "rename" &&
        sidebar.groupNameEditor.groupId === created.id,
      "expected editing of the already-created group",
    );
    sidebar.groupNameEditor!.value = "Named group";
    sidebar.commitInlineGroupNameEditor();

    assert(
      store.getGroups()[1].id === created.id,
      "expected stable group identity",
    );
    assert(
      store.getGroups()[1].name === "Named group",
      "expected the entered name",
    );
    assert(
      store.getGroups()[0].name === "Existing",
      "expected existing groups unchanged",
    );
  });

  it("keeps the group and default name when naming is cancelled", function () {
    sidebar.createGroupFromUngroupedTabs();
    const created = store.getGroups()[1];
    sidebar.groupNameEditor!.value = "Uncommitted";
    sidebar.cancelInlineGroupNameEditor();

    assert(sidebar.groupNameEditor === null, "expected editing to end");
    assert(
      store.getGroups()[1].name === created.name,
      "expected the default name to remain",
    );
    assert(
      store.getGroups()[1].id === created.id,
      "expected the created group to remain",
    );
  });

  it("does nothing when all tabs are already grouped", function () {
    tabs = [tabs[0]];
    sidebar.createGroupFromUngroupedTabs();

    assert(store.getGroups().length === 1, "expected no empty group");
    assert(
      sidebar.groupNameEditor === null && !focused,
      "expected no naming prompt",
    );
  });
});
