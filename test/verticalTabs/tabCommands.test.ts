import TabCommandController from "../../src/modules/verticalTabs/tabCommands";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("TabCommandController", function () {
  let selectedItemIDs: number[];
  let window: _ZoteroTypes.MainWindow;

  beforeEach(function () {
    selectedItemIDs = [];
    (globalThis as any).ztoolkit = {
      log: () => undefined,
    };
    (globalThis as any).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync: () => [
              { value: "Menu Item", attributes: null },
            ],
          },
        },
      },
    };
    (globalThis as any).Zotero = {
      getString: (key: string) => key,
      Items: {
        get: (itemID: number) => {
          if (itemID === 101) {
            return { id: 101, parentItemID: 201 };
          }
          if (itemID === 201) {
            return { id: 201, parentItemID: null };
          }
          return null;
        },
      },
      Prefs: {
        get: () => false,
      },
    };

    window = {
      Zotero_Tabs: {
        _getTab: () => ({
          tab: {
            id: "tab-1",
            type: "reader",
            data: { itemID: 101 },
          },
          tabIndex: 1,
        }),
      },
      ZoteroPane_Local: {
        selectItem: (itemID: number) => {
          selectedItemIDs.push(itemID);
        },
      },
    } as unknown as _ZoteroTypes.MainWindow;
  });

  it("shows a reader attachment's parent item in the library", function () {
    const controller = new TabCommandController(window);

    controller.showInLibrary("tab-1");

    assert(
      JSON.stringify(selectedItemIDs) === JSON.stringify([201]),
      "expected the parent bibliographic item to be selected",
    );
  });

  it("shows a closed group member's parent item in the library", function () {
    const controller = new TabCommandController(window);

    controller.showMemberInLibrary({ itemID: 101, parentItemID: null });

    assert(
      JSON.stringify(selectedItemIDs) === JSON.stringify([201]),
      "expected the persisted member to select its parent item",
    );
  });

  it("adds Show in Library only to sidebar command items", function () {
    const controller = new TabCommandController(window);

    const sidebarItems = controller.getSidebarContextMenuItems("tab-1");
    const horizontalItems = controller.getContextMenuItems("tab-1");

    assert(
      sidebarItems[0]?.id === "show-in-library",
      "expected Show in Library to be the first sidebar command",
    );
    assert(
      !horizontalItems.some((item) => item.id === "show-in-library"),
      "expected the horizontal enhancement menu to avoid a duplicate command",
    );
  });
});
