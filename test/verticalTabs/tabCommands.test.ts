import TabCommandController from "../../src/modules/verticalTabs/tabCommands";
import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import SidebarMenuController from "../../src/modules/verticalTabs/sidebarMenu";
import { VirtualGroupMember } from "../../src/modules/verticalTabs/types";

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

  describe("reference copying", function () {
    let controller: TabCommandController;
    let copyCalls: unknown[][];
    let exportCalls: unknown[][];
    let copyReferenceEnabled: boolean;
    let format: {
      mode: string;
      id: string;
      locale?: string;
      contentType?: string;
      options?: Record<string, boolean>;
    };

    function makeItem(
      id: number,
      kind = "regular",
      parent?: Zotero.Item,
    ): Zotero.Item {
      return {
        id,
        parentItemID: parent?.id ?? null,
        topLevelItem: parent,
        isNote: () => kind === "note",
        isAttachment: () => kind === "attachment",
        isRegularItem: () => kind === "regular",
      } as Zotero.Item;
    }

    beforeEach(function () {
      copyCalls = [];
      exportCalls = [];
      copyReferenceEnabled = true;
      format = { mode: "bibliography", id: "test-style" };
      const firstPaper = makeItem(201);
      const secondPaper = makeItem(202);
      const items = [
        firstPaper,
        secondPaper,
        makeItem(101, "attachment", firstPaper),
        makeItem(102, "attachment", secondPaper),
        makeItem(103, "attachment", firstPaper),
        makeItem(301, "note"),
        makeItem(302, "attachment"),
      ];
      Object.assign(Zotero, {
        Items: {
          get: (id: number) => items.find((item) => item.id === id) ?? null,
        },
        Prefs: {
          get: (key: string) =>
            key === "export.quickCopy.locale"
              ? "en-US"
              : key.endsWith("enableCopyReference")
                ? copyReferenceEnabled
                : null,
        },
        QuickCopy: {
          lastActiveURL: "https://example.com",
          getFormatFromURL: () => format,
          getNoteFormat: () => ({ mode: "export", id: "note-format" }),
          unserializeSetting: (value: unknown) => value,
        },
      });
      Object.assign(window, {
        Zotero_File_Interface: {
          copyItemsToClipboard: (items: Zotero.Item[], ...args: unknown[]) => {
            copyCalls.push([items.map((item) => item.id), ...args]);
          },
          exportItemsToClipboard: (items: Zotero.Item[], setting: unknown) => {
            exportCalls.push([items.map((item) => item.id), setting]);
          },
        },
      });
      controller = new TabCommandController(window);
    });

    it("copies all distinct parent references with one native call", function () {
      controller.copyGroupReferences([
        { itemID: 101, parentItemID: null },
        { itemID: 103, parentItemID: 201 },
        { itemID: 102, parentItemID: 202 },
      ]);

      assert(
        JSON.stringify(copyCalls) ===
          JSON.stringify([[[201, 202], "test-style", "en-US", false, false]]),
        "expected a single bibliography containing both papers without duplicates",
      );
    });

    it("skips missing items and retains resolvable parents", function () {
      controller.copyGroupReferences([
        { itemID: null, parentItemID: null },
        { itemID: 999, parentItemID: null },
        { itemID: 999, parentItemID: 201 },
        { itemID: 102, parentItemID: 999 },
        { itemID: 301, parentItemID: null },
        { itemID: 302, parentItemID: null },
      ]);

      assert(
        JSON.stringify(copyCalls[0]?.[0]) === JSON.stringify([201, 202]),
        "expected only valid bibliographic items after resolving parents",
      );
    });

    it("leaves the clipboard unchanged when no items resolve", function () {
      controller.copyGroupReferences([]);
      controller.copyGroupReferences([{ itemID: 999, parentItemID: null }]);

      assert(
        copyCalls.length === 0 && exportCalls.length === 0,
        "expected no clipboard writes for empty or unresolvable groups",
      );
    });

    it("preserves the configured locale and HTML output mode", function () {
      format.locale = "zh-CN";
      format.contentType = "html";
      controller.copyGroupReferences([{ itemID: 101, parentItemID: 201 }]);

      assert(
        JSON.stringify(copyCalls[0]) ===
          JSON.stringify([[201], "test-style", "zh-CN", true, false]),
        "expected the Quick Copy locale and HTML setting to reach the native API",
      );
    });

    it("exports the whole group once with the selected translator", function () {
      format = {
        mode: "export",
        id: "test-translator",
        options: { exportNotes: true },
      };
      controller.copyGroupReferences([
        { itemID: 101, parentItemID: 201 },
        { itemID: 102, parentItemID: 202 },
      ]);

      assert(
        copyCalls.length === 0 &&
          JSON.stringify(exportCalls) ===
            JSON.stringify([[[201, 202], format]]),
        "expected one export call with both papers and the translator options",
      );
    });

    it("retains the native note format for groups of standalone notes", function () {
      controller.copyGroupReferences([{ itemID: 301, parentItemID: null }]);

      assert(
        JSON.stringify(exportCalls) ===
          JSON.stringify([[[301], { mode: "export", id: "note-format" }]]),
        "expected the existing note Quick Copy behavior",
      );
    });

    it("preserves single-tab and closed-member reference copying", function () {
      controller.copyReference("tab-1");
      controller.copyMemberReference({ itemID: 101, parentItemID: 201 });

      const expected = [[201], "test-style", "en-US", false, false];
      assert(
        JSON.stringify(copyCalls) === JSON.stringify([expected, expected]),
        "expected both existing commands to keep copying one parent reference",
      );
    });

    describe("group-header menu", function () {
      class MenuElement {
        attributes: Record<string, string> = {};
        children: MenuElement[] = [];
        command?: () => Promise<void>;
        get firstChild() {
          return this.children[0];
        }
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        }
        addEventListener(_name: string, handler: () => Promise<void>) {
          this.command = handler;
        }
        appendChild(child: MenuElement) {
          this.children.push(child);
        }
        removeChild(child: MenuElement) {
          this.children.splice(this.children.indexOf(child), 1);
        }
        hidePopup() {}
        openPopupAtScreen() {}
      }

      function openMenu(members: VirtualGroupMember[]) {
        Object.assign(ztoolkit, {
          createXULElement: () => new MenuElement(),
        });
        Object.assign(addon.data.locale!.current, {
          formatMessagesSync: (messages: { id: string }[]) =>
            messages.map(({ id }) => ({ value: id, attributes: null })),
        });
        const store = new TabGroupStore(window);
        store.setGroups([
          {
            id: "group-1",
            name: "Group",
            color: "#F6B433",
            collapsed: true,
            sortMode: "manual",
            members,
          },
        ]);
        const menu = new SidebarMenuController(
          {} as Document,
          controller,
          store,
          {
            getTrackedTabByKey: () => null,
            getTrackedTabByMemberKey: () => null,
          },
          {
            beginCreateGroupEditor: () => undefined,
            beginRenameGroupEditor: () => undefined,
            openGroupMembers: async () => undefined,
            closeGroupMembers: () => undefined,
          },
        );
        const popup = new MenuElement();
        menu.showContextMenu(
          popup as unknown as XULPopupElement,
          { kind: "group-header", groupId: "group-1" },
          0,
          0,
        );
        return popup.children.find((item) =>
          item.attributes.label?.endsWith("copy-group-references"),
        );
      }

      it("copies both open and closed members from a collapsed group", async function () {
        const members: VirtualGroupMember[] = [101, 102].map(
          (itemID, index) => ({
            id: `member-${itemID}`,
            key: `item:${itemID}`,
            sourceTabKey: index === 0 ? "tab:1" : null,
            tabId: index === 0 ? "1" : null,
            type: "reader",
            title: "Paper",
            itemID,
            parentItemID: null,
            isOpen: index === 0,
            openedAt: null,
            iconKey: "reader",
          }),
        );
        const item = openMenu(members);

        assert(
          item && !item.attributes.disabled,
          "expected an enabled copy item",
        );
        await item?.command?.();

        assert(
          JSON.stringify(copyCalls) ===
            JSON.stringify([[[201, 202], "test-style", "en-US", false, false]]),
          "expected the menu action to copy the complete stored group",
        );
      });

      it("hides the group copy action when reference copying is disabled", function () {
        copyReferenceEnabled = false;
        assert(
          !openMenu([]),
          "expected the existing preference to hide the action",
        );
      });

      it("disables group copying for an empty group", async function () {
        const item = openMenu([]);
        assert(
          item?.attributes.disabled === "true",
          "expected a disabled action",
        );
        await item?.command?.();
        assert(copyCalls.length === 0, "expected no native clipboard write");
      });
    });
  });
});
