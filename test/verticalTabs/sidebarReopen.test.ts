import VerticalTabSidebar from "../../src/modules/verticalTabs/sidebar";
import TabCommandController from "../../src/modules/verticalTabs/tabCommands";
import { VirtualGroupMember } from "../../src/modules/verticalTabs/types";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

type ReopenSidebar = {
  ensureGroupMemberOpen: (
    groupId: string,
    memberKey: string,
    select: boolean,
  ) => Promise<boolean>;
};

describe("sidebar note reopening", function () {
  let originalGlobals: {
    Zotero: typeof Zotero;
    ztoolkit: typeof ztoolkit;
    addon: typeof addon;
  };
  let member: VirtualGroupMember;
  let sidebar: ReopenSidebar;
  let controller: TabCommandController;
  let noteCalls: Array<{
    itemID: number;
    options: { openInBackground?: boolean; openInWindow?: boolean };
  }>;
  let attachmentCalls: number[];
  let selectedTabs: string[];
  let reconcileCount: number;
  let openTabID: string | null;
  let note: boolean;
  let missing: boolean;
  let parentHasPDF: boolean;

  beforeEach(function () {
    originalGlobals = {
      Zotero: globalThis.Zotero,
      ztoolkit: globalThis.ztoolkit,
      addon: globalThis.addon,
    };
    noteCalls = [];
    attachmentCalls = [];
    selectedTabs = [];
    reconcileCount = 0;
    openTabID = null;
    note = true;
    missing = false;
    parentHasPDF = true;
    member = {
      id: "member-1",
      key: "item:101",
      sourceTabKey: null,
      tabId: null,
      type: "note",
      title: "Note",
      itemID: 101,
      parentItemID: 201,
      isOpen: false,
      openedAt: null,
      iconKey: "note",
    };
    Object.assign(globalThis, {
      ztoolkit: { log: () => {} },
      addon: { data: {} },
      Zotero: {
        getString: (key: string) => key,
        Prefs: { get: () => true },
        Items: {
          get: (id: number) => {
            if (missing) {
              return null;
            }
            if (id === 201) {
              return {
                id,
                isNote: () => false,
                isFileAttachment: () => false,
                getBestAttachment: () => (parentHasPDF ? { id: 301 } : null),
              };
            }
            if (id === 101) {
              return {
                id,
                isNote: () => note,
                isFileAttachment: () => !note,
                getBestAttachment: () => {
                  throw new Error("Notes must not resolve attachments");
                },
              };
            }
            return null;
          },
        },
        Notes: {
          open: async (
            itemID: number,
            _location: unknown,
            options: { openInBackground?: boolean; openInWindow?: boolean },
          ) => {
            noteCalls.push({ itemID, options });
            openTabID = "reopened-note";
            return null;
          },
        },
        FileHandlers: {
          open: () => {
            throw new Error("Notes must not use file handlers");
          },
        },
      },
    });
    controller = new TabCommandController({} as _ZoteroTypes.MainWindow);
    Object.assign(controller, {
      openAttachmentTab: async (itemID: number) => {
        attachmentCalls.push(itemID);
        return "reopened-reader";
      },
    });
    // Exercise the reopen workflow without mounting the sidebar UI.
    sidebar = Object.assign(Object.create(VerticalTabSidebar.prototype), {
      commandController: controller,
      pendingMemberOpenPromises: new Map<string, Promise<boolean>>(),
      groupStore: { findGroupById: () => ({ members: [member] }) },
      findTrackedTabByMemberKey: () =>
        openTabID ? { tabId: openTabID } : null,
      selectTrackedTab: (tab: { tabId: string }) =>
        selectedTabs.push(tab.tabId),
      wait: async () => {},
      tracker: {
        requestReconcile: () => reconcileCount++,
        scheduleDelayedReconcile: () => {},
      },
    }) as ReopenSidebar;
  });

  afterEach(function () {
    Object.assign(globalThis, originalGlobals);
  });

  for (const type of ["note", "note-unloaded"]) {
    it(`reopens a closed ${type} with the note API and selects it`, async function () {
      member.type = type;

      const opened = await sidebar.ensureGroupMemberOpen(
        "group-1",
        member.key,
        true,
      );

      assert(opened, "expected the note to reopen");
      assert(noteCalls.length === 1, "expected one native note open");
      assert(noteCalls[0].itemID === 101, "expected the note, not its parent");
      assert(
        noteCalls[0].options.openInBackground === true &&
          noteCalls[0].options.openInWindow === false,
        "expected a background tab, not a separate window",
      );
      assert(
        selectedTabs[0] === "reopened-note",
        "expected the clicked note to be selected",
      );
      assert(
        reconcileCount === 1,
        "expected reopened note tracking to refresh",
      );
      assert(attachmentCalls.length === 0, "expected no attachment open");
    });
  }

  it("deduplicates concurrent opens and keeps batch opens in the background", async function () {
    const results = await Promise.all([
      sidebar.ensureGroupMemberOpen("group-1", member.key, false),
      sidebar.ensureGroupMemberOpen("group-1", member.key, false),
    ]);

    assert(results.every(Boolean), "expected both callers to succeed");
    assert(noteCalls.length === 1, "expected only one note tab");
    assert(
      selectedTabs.length === 0,
      "expected no selection during batch open",
    );
  });

  for (const hasPDF of [true, false]) {
    it(`loads a child note from the menu when its parent ${hasPDF ? "has" : "has no"} PDF`, async function () {
      parentHasPDF = hasPDF;
      const command = controller
        .getVirtualMemberContextMenuItems(member)
        .find((item) => item.id === "load");
      assert(command && !command.disabled, "expected an enabled load command");
      await command?.handler();

      assert(noteCalls.length === 1, "expected the menu to open the note");
      assert(
        noteCalls[0].itemID === 101,
        "expected the child note ID, not its parent",
      );
      assert(attachmentCalls.length === 0, "expected no attachment open");
    });
  }

  it("loads a standalone note from the member context menu", async function () {
    member.parentItemID = null;
    const command = controller
      .getVirtualMemberContextMenuItems(member)
      .find((item) => item.id === "load");
    assert(command, "expected a load command");
    await command?.handler();

    assert(noteCalls.length === 1, "expected the menu to open the note");
    assert(noteCalls[0].itemID === 101, "expected the standalone note ID");
    assert(attachmentCalls.length === 0, "expected no attachment open");
  });

  it("preserves the parent attachment fallback when the member has no item ID", async function () {
    member.itemID = null;
    member.type = "reader";
    const command = controller
      .getVirtualMemberContextMenuItems(member)
      .find((item) => item.id === "load");
    assert(command, "expected a load command");
    await command?.handler();

    assert(attachmentCalls.length === 1, "expected one attachment open");
    assert(attachmentCalls[0] === 301, "expected the parent's PDF");
    assert(noteCalls.length === 0, "expected no note open");
  });

  it("preserves attachment reopening", async function () {
    note = false;
    member.type = "reader";
    const opened = await sidebar.ensureGroupMemberOpen(
      "group-1",
      member.key,
      false,
    );

    assert(opened, "expected the attachment to reopen");
    assert(attachmentCalls[0] === 101, "expected the attachment reader path");
    assert(noteCalls.length === 0, "expected no note open");
  });

  it("does not open a missing item", async function () {
    missing = true;
    const opened = await sidebar.ensureGroupMemberOpen(
      "group-1",
      member.key,
      true,
    );

    assert(!opened, "expected a missing item to fail reopening");
    assert(noteCalls.length === 0, "expected no note open");
    assert(reconcileCount === 0, "expected no successful-open refresh");
  });
});
