import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { TrackedTab, VirtualGroupMember } from "./types";

export type TabCommandID =
  | "close"
  | "show-in-library"
  | "show-in-filesystem"
  | "reload"
  | "load"
  | "copy-to-clipboard";

export interface TabCommandItem {
  id: TabCommandID;
  label: string;
  disabled?: boolean;
  handler: () => Promise<void> | void;
}

type ItemContext = Pick<
  TrackedTab | VirtualGroupMember,
  "itemID" | "parentItemID"
>;

type NativeTabEntry = {
  tab: _ZoteroTypes.TabInstance;
  tabIndex: number;
};

function isReaderTab(
  tab: _ZoteroTypes.TabInstance | TrackedTab | null | undefined,
) {
  return Boolean(
    tab && (tab.type === "reader" || tab.type === "reader-unloaded"),
  );
}

export default class TabCommandController {
  private readonly window: _ZoteroTypes.MainWindow;
  private static readonly RELOAD_CLOSE_TIMEOUT_MS = 800;
  private static readonly RELOAD_CLOSE_POLL_MS = 20;
  private static readonly READER_REOPEN_SETTLE_MS = 300;
  private static readonly REOPEN_TAB_TIMEOUT_MS = 2000;

  constructor(window: _ZoteroTypes.MainWindow) {
    this.window = window;
  }

  public select(tabId: string | null): boolean {
    if (!tabId) {
      return false;
    }

    const nativeTab = this.getNativeTab(tabId, false);
    if (!nativeTab) {
      ztoolkit.log("TabCommandController.select skipped missing tab", tabId);
      return false;
    }

    try {
      this.window.Zotero_Tabs.select(nativeTab.id);
      return true;
    } catch (error) {
      ztoolkit.log("TabCommandController.select failed", tabId, error);
      return false;
    }
  }

  public hasOpenTab(tabId: string | null): boolean {
    if (!tabId) {
      return false;
    }

    try {
      const nativeTab = this.getNativeTab(tabId, false);
      return Boolean(nativeTab?.id);
    } catch {
      return false;
    }
  }

  public close(tabId: string | null): void {
    if (!tabId || tabId === "zotero-pane") {
      return;
    }

    const nativeTab = this.getNativeTab(tabId, false);
    if (!nativeTab) {
      return;
    }

    try {
      const closedTabId = nativeTab.id;
      this.window.Zotero_Tabs.close(closedTabId);
      this.scheduleClosedReaderCleanup(closedTabId);
    } catch (error) {
      ztoolkit.log("TabCommandController.close failed", tabId, error);
    }
  }

  public moveOpenTabs(
    tabIds: string[] | string | null,
    targetIndex: number,
  ): void {
    const normalizedTabIds = Array.from(
      new Set(
        (Array.isArray(tabIds) ? tabIds : [tabIds]).filter(
          (tabId): tabId is string => Boolean(tabId && tabId !== "zotero-pane"),
        ),
      ),
    );
    if (!normalizedTabIds.length || targetIndex < 1) {
      return;
    }

    try {
      if (normalizedTabIds.length === 1) {
        this.window.Zotero_Tabs.move(normalizedTabIds[0], targetIndex);
        return;
      }

      const entries = normalizedTabIds
        .map((tabId) => this.getNativeTabEntry(tabId, false))
        .filter((entry): entry is NativeTabEntry => Boolean(entry))
        .sort((left, right) => left.tabIndex - right.tabIndex);
      if (!entries.length) {
        return;
      }

      let insertionIndex = targetIndex;
      entries.forEach((entry) => {
        if (entry.tabIndex < targetIndex) {
          insertionIndex -= 1;
        }
      });
      insertionIndex = Math.max(1, insertionIndex);

      entries.forEach((entry, offset) => {
        this.window.Zotero_Tabs.move(entry.tab.id, insertionIndex + offset);
      });
    } catch (error) {
      ztoolkit.log("TabCommandController.moveOpenTabs failed", {
        tabIds: normalizedTabIds,
        targetIndex,
        error,
      });
    }
  }

  public async showInFilesystem(tabId: string | null): Promise<void> {
    try {
      const tab = this.getNativeTab(tabId);
      if (!tab || !isReaderTab(tab)) {
        return;
      }

      const itemID = tab.data?.itemID;
      if (typeof itemID !== "number") {
        return;
      }
      const item = Zotero.Items.get(itemID);
      const attachment = item.isFileAttachment()
        ? item
        : await item.getBestAttachment();
      if (!attachment) {
        return;
      }
      await this.window.ZoteroPane.showAttachmentInFilesystem(attachment.id);
    } catch (error) {
      ztoolkit.log(
        "TabCommandController.showInFilesystem failed",
        tabId,
        error,
      );
    }
  }

  public showInLibrary(tabId: string | null): void {
    try {
      const tab = this.getNativeTab(tabId);
      const itemID = tab?.data?.itemID;
      if (typeof itemID !== "number") {
        return;
      }

      this.showItemInLibrary({ itemID, parentItemID: null });
    } catch (error) {
      ztoolkit.log("TabCommandController.showInLibrary failed", tabId, error);
    }
  }

  public async reload(tabId: string | null): Promise<void> {
    try {
      const entry = this.getNativeTabEntry(tabId);
      const tab = entry?.tab ?? null;
      if (!entry || !tab || !isReaderTab(tab)) {
        return;
      }

      const itemID = tab.data?.itemID;
      if (typeof itemID !== "number") {
        return;
      }
      const item = Zotero.Items.get(itemID);
      if (!item) {
        return;
      }
      const attachmentID = await this.resolveAttachmentItemID({
        itemID,
        parentItemID: null,
      });
      const reopenItem =
        attachmentID == null
          ? await this.resolveForegroundOpenItem({
              itemID,
              parentItemID: null,
            })
          : null;

      this.window.Zotero_Tabs.close(entry.tab.id);
      await this.waitForTabToClose(entry.tab.id);
      await this.wait(TabCommandController.READER_REOPEN_SETTLE_MS);
      this.releaseReaderForTabID(entry.tab.id);
      if (attachmentID == null) {
        if (!reopenItem) {
          return;
        }
        await (Zotero as any).FileHandlers.open(reopenItem);
        return;
      }

      await this.openAttachmentTab(attachmentID, { selectAfterOpen: true });
    } catch (error) {
      ztoolkit.log("TabCommandController.reload failed", tabId, error);
    }
  }

  public async openAttachmentTab(
    attachmentID: number,
    options: {
      openInBackground?: boolean;
      selectAfterOpen?: boolean;
    } = {},
  ): Promise<string | null> {
    this.releaseStaleReadersForItem(attachmentID);
    const reader = await Zotero.Reader.open(attachmentID, undefined, {
      openInBackground: options.openInBackground,
    });
    const openedTabID =
      typeof (reader as { tabID?: unknown } | undefined)?.tabID === "string"
        ? (reader as { tabID: string }).tabID
        : await this.waitForReaderTab(attachmentID);

    if (options.selectAfterOpen && openedTabID) {
      this.select(openedTabID);
    }
    return openedTabID;
  }

  public copyReference(tabId: string | null): void {
    try {
      const tab = this.getNativeTab(tabId);
      if (!tab || !isReaderTab(tab)) {
        return;
      }

      const itemID = tab.data?.itemID;
      if (typeof itemID !== "number") {
        return;
      }
      const item = Zotero.Items.get(itemID);
      if (!item) {
        return;
      }
      this.copyReferenceForItem(item);
    } catch (error) {
      ztoolkit.log("TabCommandController.copyReference failed", tabId, error);
    }
  }

  public async showMemberInFilesystem(
    member: Pick<VirtualGroupMember, "itemID" | "parentItemID">,
  ): Promise<void> {
    try {
      const attachmentID = await this.resolveAttachmentItemID(member);
      if (attachmentID == null) {
        return;
      }
      await this.window.ZoteroPane.showAttachmentInFilesystem(attachmentID);
    } catch (error) {
      ztoolkit.log(
        "TabCommandController.showMemberInFilesystem failed",
        member,
        error,
      );
    }
  }

  public showMemberInLibrary(
    member: Pick<VirtualGroupMember, "itemID" | "parentItemID">,
  ): void {
    try {
      this.showItemInLibrary(member);
    } catch (error) {
      ztoolkit.log(
        "TabCommandController.showMemberInLibrary failed",
        member,
        error,
      );
    }
  }

  public copyMemberReference(
    member: Pick<VirtualGroupMember, "itemID" | "parentItemID">,
  ): void {
    try {
      const item = this.resolvePrimaryItem(member);
      if (!item) {
        return;
      }
      this.copyReferenceForItem(item);
    } catch (error) {
      ztoolkit.log(
        "TabCommandController.copyMemberReference failed",
        member,
        error,
      );
    }
  }

  public getContextMenuItems(tabId: string | null): TabCommandItem[] {
    const nativeTab = this.getNativeTab(tabId, false);
    const reader = isReaderTab(nativeTab);
    const items: TabCommandItem[] = [
      {
        id: "close",
        label: getString("close-tab"),
        handler: () => this.close(tabId),
      },
    ];

    if (getPref("enableCopyReference")) {
      items.push({
        id: "copy-to-clipboard",
        label: getString("copy-to-clipboard"),
        disabled: !reader,
        handler: () => this.copyReference(tabId),
      });
    }

    if (getPref("enableGoToAttachment")) {
      items.push({
        id: "show-in-filesystem",
        label: getString("show-in-filesystem"),
        disabled: !reader,
        handler: () => this.showInFilesystem(tabId),
      });
    }

    if (getPref("enableReloadTab")) {
      items.push({
        id: "reload",
        label: getString("reload"),
        disabled: !reader,
        handler: () => this.reload(tabId),
      });
    }

    return items;
  }

  public getSidebarContextMenuItems(tabId: string | null): TabCommandItem[] {
    return [
      {
        id: "show-in-library",
        label: Zotero.getString("general.showInLibrary"),
        handler: () => this.showInLibrary(tabId),
      },
      ...this.getContextMenuItems(tabId),
    ];
  }

  public getVirtualMemberContextMenuItems(
    member: Pick<VirtualGroupMember, "itemID" | "parentItemID">,
  ): TabCommandItem[] {
    const primaryItemCandidate = this.resolvePrimaryItem(member);
    const referenceCandidate = primaryItemCandidate;
    const items: TabCommandItem[] = [
      {
        id: "show-in-library",
        label: Zotero.getString("general.showInLibrary"),
        disabled: !primaryItemCandidate,
        handler: () => this.showMemberInLibrary(member),
      },
    ];

    if (getPref("enableCopyReference")) {
      items.push({
        id: "copy-to-clipboard",
        label: getString("copy-to-clipboard"),
        disabled: !referenceCandidate,
        handler: () => this.copyMemberReference(member),
      });
    }

    if (getPref("enableGoToAttachment")) {
      items.push({
        id: "show-in-filesystem",
        label: getString("show-in-filesystem"),
        disabled: !primaryItemCandidate,
        handler: () => this.showMemberInFilesystem(member),
      });
    }

    if (getPref("enableReloadTab")) {
      items.push({
        id: "load",
        label: getString("load-tab"),
        disabled: !primaryItemCandidate,
        handler: () => this.loadMemberTab(member),
      });
    }

    return items;
  }

  private getNativeTab(tabId: string | null, logError = true) {
    return this.getNativeTabEntry(tabId, logError)?.tab ?? null;
  }

  private getNativeTabEntry(
    tabId: string | null,
    logError = true,
  ): NativeTabEntry | null {
    if (!tabId) {
      return null;
    }

    try {
      return this.window.Zotero_Tabs._getTab(tabId);
    } catch (error) {
      if (logError) {
        ztoolkit.log("TabCommandController.getNativeTab failed", tabId, error);
      }
      return null;
    }
  }

  private async waitForTabToClose(tabId: string): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < TabCommandController.RELOAD_CLOSE_TIMEOUT_MS) {
      if (!this.getNativeTab(tabId, false)) {
        return;
      }
      await this.wait(TabCommandController.RELOAD_CLOSE_POLL_MS);
    }
  }

  private async waitForReaderTab(itemID: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < TabCommandController.REOPEN_TAB_TIMEOUT_MS) {
      const tabId = this.findReaderTabIdByItemID(itemID);
      if (tabId) {
        return tabId;
      }
      await this.wait(TabCommandController.RELOAD_CLOSE_POLL_MS);
    }
    return null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.window.setTimeout(resolve, ms);
    });
  }

  private resolvePrimaryItem(context: ItemContext): any | null {
    const candidateIDs = [context.parentItemID, context.itemID].filter(
      (itemID, index, array): itemID is number =>
        typeof itemID === "number" && array.indexOf(itemID) === index,
    );

    for (const itemID of candidateIDs) {
      const item = Zotero.Items.get(itemID);
      if (item) {
        return item;
      }
    }

    return null;
  }

  private async resolveAttachmentItem(
    context: ItemContext,
  ): Promise<any | null> {
    const item = this.resolvePrimaryItem(context);
    if (!item) {
      return null;
    }

    if (item.isFileAttachment?.()) {
      return item;
    }

    return (await item.getBestAttachment?.()) ?? null;
  }

  private async resolveAttachmentItemID(
    context: ItemContext,
  ): Promise<number | null> {
    const attachment = await this.resolveAttachmentItem(context);
    return typeof attachment?.id === "number" ? attachment.id : null;
  }

  private async resolveForegroundOpenItem(
    context: ItemContext,
  ): Promise<any | null> {
    const item = this.resolvePrimaryItem(context);
    if (!item) {
      return null;
    }

    if (item.isFileAttachment?.()) {
      return item;
    }

    return (await item.getBestAttachment?.()) ?? item;
  }

  private showItemInLibrary(context: ItemContext): void {
    const item = this.resolvePrimaryItem(context);
    if (!item) {
      return;
    }

    const itemID =
      typeof item.parentItemID === "number" ? item.parentItemID : item.id;
    if (typeof itemID !== "number") {
      return;
    }

    this.window.ZoteroPane_Local.selectItem(itemID);
  }

  private findReaderTabIdByItemID(itemID: number): string | null {
    const tabs = Array.isArray(this.window.Zotero_Tabs._tabs)
      ? this.window.Zotero_Tabs._tabs
      : [];

    for (let index = tabs.length - 1; index >= 0; index -= 1) {
      const tab = tabs[index] as
        | {
            id?: unknown;
            type?: unknown;
            data?: { itemID?: unknown; itemId?: unknown };
          }
        | undefined;
      if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
        continue;
      }

      const tabItemID = tab.data?.itemID ?? tab.data?.itemId;
      if (tabItemID === itemID && typeof tab.id === "string") {
        return tab.id;
      }
    }

    return null;
  }

  private copyReferenceForItem(item: any): void {
    const topLevelItem = item.topLevelItem ?? item;
    let items = [topLevelItem];

    let format = Zotero.QuickCopy.getFormatFromURL(
      Zotero.QuickCopy.lastActiveURL,
    );
    if (
      items.every(
        (currentItem) => currentItem.isNote?.() || currentItem.isAttachment?.(),
      )
    ) {
      format = Zotero.QuickCopy.getNoteFormat();
    }
    format = Zotero.QuickCopy.unserializeSetting(format);

    if (format.mode === "bibliography") {
      items = items.filter((currentItem) => currentItem.isRegularItem?.());
    }

    if (!items.length) {
      return;
    }

    const locale = format.locale
      ? format.locale
      : Zotero.Prefs.get("export.quickCopy.locale");

    if (format.mode === "bibliography") {
      (this.window.Zotero_File_Interface as any).copyItemsToClipboard(
        items,
        format.id,
        locale,
        format.contentType === "html",
        false,
      );
    } else if (format.mode === "export") {
      this.window.Zotero_File_Interface.exportItemsToClipboard(items, format);
    }
  }

  private async loadMemberTab(
    member: Pick<VirtualGroupMember, "itemID" | "parentItemID">,
  ): Promise<void> {
    try {
      const attachmentID = await this.resolveAttachmentItemID(member);
      if (attachmentID == null) {
        return;
      }
      await this.openAttachmentTab(attachmentID, {
        openInBackground: true,
      });
    } catch (error) {
      ztoolkit.log("TabCommandController.loadMemberTab failed", member, error);
    }
  }

  private scheduleClosedReaderCleanup(tabId: string): void {
    this.window.setTimeout(() => {
      this.releaseReaderForTabID(tabId);
    }, 0);
    this.window.setTimeout(() => {
      this.releaseReaderForTabID(tabId);
    }, TabCommandController.READER_REOPEN_SETTLE_MS);
  }

  private releaseReaderForTabID(tabId: string): void {
    const readers = (Zotero.Reader as unknown as { _readers?: unknown })
      ._readers;
    if (!Array.isArray(readers)) {
      return;
    }

    for (const reader of [...readers]) {
      try {
        if ((reader as { tabID?: unknown })?.tabID !== tabId) {
          continue;
        }
        this.disposeReader(reader);
        const index = readers.indexOf(reader);
        if (index >= 0) {
          readers.splice(index, 1);
        }
      } catch (error) {
        if (!this.isDeadObjectError(error)) {
          ztoolkit.log("TabCommandController.releaseReaderForTabID failed", {
            tabId,
            error,
          });
        }
      }
    }
  }

  private releaseStaleReadersForItem(itemID: number): void {
    const readers = (Zotero.Reader as unknown as { _readers?: unknown })
      ._readers;
    if (!Array.isArray(readers)) {
      return;
    }

    for (const reader of [...readers]) {
      try {
        if ((reader as { itemID?: unknown })?.itemID !== itemID) {
          continue;
        }
        const readerTabID = (reader as { tabID?: unknown })?.tabID;
        if (
          typeof readerTabID !== "string" ||
          this.getNativeTab(readerTabID, false)
        ) {
          continue;
        }
        this.disposeReader(reader);
        const index = readers.indexOf(reader);
        if (index >= 0) {
          readers.splice(index, 1);
        }
      } catch (error) {
        if (!this.isDeadObjectError(error)) {
          ztoolkit.log(
            "TabCommandController.releaseStaleReadersForItem failed",
            {
              itemID,
              error,
            },
          );
        }
      }
    }
  }

  private disposeReader(reader: unknown): void {
    try {
      (reader as { uninit?: () => void })?.uninit?.();
    } catch (error) {
      if (!this.isDeadObjectError(error)) {
        ztoolkit.log("TabCommandController.disposeReader failed", error);
      }
    }
  }

  private isDeadObjectError(error: unknown): boolean {
    return String(error).includes("can't access dead object");
  }
}
