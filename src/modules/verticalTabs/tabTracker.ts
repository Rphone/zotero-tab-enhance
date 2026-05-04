import { LIBRARY_TAB_ID, TabTrackerSnapshot, TrackedTab } from "./types";

type SnapshotListener = (snapshot: TabTrackerSnapshot) => void;

type RuntimeTabLike = Partial<_ZoteroTypes.TabInstance> & {
  id?: string;
  tabId?: string;
  tabID?: string;
  type?: string;
  title?: string;
  data?: {
    itemID?: unknown;
    itemId?: unknown;
    title?: unknown;
    [key: string]: unknown;
  };
  selected?: boolean;
};

export default class TabTrackerService {
  private readonly window: _ZoteroTypes.MainWindow;
  private initialized = false;
  private snapshot: TabTrackerSnapshot = {
    tabs: [],
    selectedTabKey: null,
  };
  private openedAtByTabId = new Map<string, number>();
  private listeners = new Set<SnapshotListener>();
  private pendingReconcileReason: string | null = null;
  private queuedReconcileTimer: number | null = null;
  private delayedReconcileTimers = new Set<number>();
  private parentItemIDByItemID = new Map<number, number | null>();

  constructor(window: _ZoteroTypes.MainWindow) {
    this.window = window;
  }

  public init(): void {
    if (this.initialized) {
      ztoolkit.log("TabTrackerService already initialized, skipping");
      return;
    }

    this.initialized = true;
    this.reconcile("init");
    ztoolkit.log("TabTrackerService initialized");
  }

  public destroy(): void {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    this.snapshot = { tabs: [], selectedTabKey: null };
    this.openedAtByTabId.clear();
    this.parentItemIDByItemID.clear();
    if (this.queuedReconcileTimer != null) {
      this.window.clearTimeout(this.queuedReconcileTimer);
      this.queuedReconcileTimer = null;
    }
    this.pendingReconcileReason = null;
    this.delayedReconcileTimers.forEach((timerId) =>
      this.window.clearTimeout(timerId),
    );
    this.delayedReconcileTimers.clear();
    this.listeners.clear();
    ztoolkit.log("TabTrackerService destroyed");
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reconcile(_reason = "unknown"): TabTrackerSnapshot {
    const runtimeTabs = this.readRuntimeTabs();
    const selectedID = this.window.Zotero_Tabs.selectedID ?? null;
    const visibleTabs = runtimeTabs.filter((tab) => this.shouldTrackTab(tab));
    const activeTabIDs = new Set(
      visibleTabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is string => Boolean(tabId)),
    );

    for (const tab of visibleTabs) {
      if (!this.openedAtByTabId.has(tab.id)) {
        this.openedAtByTabId.set(tab.id, Date.now());
      }
    }

    for (const tabId of Array.from(this.openedAtByTabId.keys())) {
      if (!activeTabIDs.has(tabId)) {
        this.openedAtByTabId.delete(tabId);
      }
    }

    const activeItemIDs = new Set(
      visibleTabs
        .map((tab) => this.extractItemID(tab))
        .filter((itemID): itemID is number => typeof itemID === "number"),
    );
    for (const itemID of Array.from(this.parentItemIDByItemID.keys())) {
      if (!activeItemIDs.has(itemID)) {
        this.parentItemIDByItemID.delete(itemID);
      }
    }

    const trackedTabs = runtimeTabs
      .map((tab, nativeIndex) => ({ tab, nativeIndex }))
      .filter(({ tab }) => this.shouldTrackTab(tab))
      .map(({ tab, nativeIndex }) =>
        this.toTrackedTab(tab, nativeIndex, selectedID),
      );

    this.snapshot = {
      tabs: trackedTabs,
      selectedTabKey:
        trackedTabs.find((tab) => tab.isSelected)?.key ??
        (selectedID ? this.makeTabKey(selectedID) : null),
    };

    this.emit();

    return this.getSnapshot();
  }

  public requestReconcile(reason = "unknown", delay = 48): void {
    if (!this.initialized) {
      return;
    }

    this.pendingReconcileReason = reason;
    if (this.queuedReconcileTimer != null) {
      return;
    }

    this.queuedReconcileTimer = this.window.setTimeout(() => {
      this.queuedReconcileTimer = null;
      const nextReason = this.pendingReconcileReason ?? reason;
      this.pendingReconcileReason = null;
      if (!this.initialized) {
        return;
      }
      this.reconcile(`queued:${nextReason}`);
    }, delay);
  }

  public getSnapshot(): TabTrackerSnapshot {
    return {
      tabs: [...this.snapshot.tabs],
      selectedTabKey: this.snapshot.selectedTabKey,
    };
  }

  public getTabs(): TrackedTab[] {
    return [...this.snapshot.tabs];
  }

  public getSelectedTab(): TrackedTab | null {
    return (
      this.snapshot.tabs.find(
        (tab) => tab.key === this.snapshot.selectedTabKey,
      ) ?? null
    );
  }

  public scheduleDelayedReconcile(
    reason: string,
    delays: number[] = [120, 360],
  ): void {
    if (!this.initialized) {
      return;
    }

    this.delayedReconcileTimers.forEach((timerId) =>
      this.window.clearTimeout(timerId),
    );
    this.delayedReconcileTimers.clear();
    delays.forEach((delay) => {
      const timerId = this.window.setTimeout(() => {
        this.delayedReconcileTimers.delete(timerId);
        if (!this.initialized) {
          return;
        }
        this.reconcile(`${reason}:delayed-${delay}`);
      }, delay);
      this.delayedReconcileTimers.add(timerId);
    });
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        ztoolkit.log("TabTrackerService listener failed", error);
      }
    });
  }

  private readRuntimeTabs(): Array<RuntimeTabLike & { id: string }> {
    const internalTabs = this.toRuntimeTabs(this.window.Zotero_Tabs._tabs);
    const stateTabs = this.toRuntimeTabs(this.window.Zotero_Tabs.getState?.());
    const mergedTabs: Array<RuntimeTabLike & { id: string }> = [];

    internalTabs.forEach((internalTab, index) => {
      const stateTab = stateTabs[index] ?? {};
      const id = this.resolveTabId(internalTab);
      if (!id) {
        return;
      }

      mergedTabs.push({
        ...internalTab,
        ...stateTab,
        data: {
          ...(internalTab.data ?? {}),
          ...(stateTab.data ?? {}),
        },
        id,
        title: this.resolveDisplayTitle(stateTab, internalTab, id),
        type: stateTab.type || internalTab.type,
        selected:
          typeof stateTab.selected === "boolean"
            ? stateTab.selected
            : internalTab.selected,
      });
    });

    return mergedTabs;
  }

  private toRuntimeTabs(tabs: unknown): RuntimeTabLike[] {
    return Array.isArray(tabs) ? (tabs as RuntimeTabLike[]) : [];
  }

  private resolveDisplayTitle(
    stateTab: RuntimeTabLike,
    internalTab: RuntimeTabLike,
    tabId: string,
  ): string {
    const stateTitle = this.normalizeTitle(stateTab.title, tabId);
    if (stateTitle) {
      return stateTitle;
    }

    const internalTitle = this.normalizeTitle(internalTab.title, tabId);
    if (internalTitle) {
      return internalTitle;
    }

    return tabId;
  }

  private normalizeTitle(
    title: string | undefined,
    tabId: string,
  ): string | null {
    if (typeof title !== "string") {
      return null;
    }

    const normalized = title.trim();
    if (!normalized) {
      return null;
    }

    if (normalized === tabId) {
      return null;
    }

    return normalized;
  }

  private resolveTabId(tab: RuntimeTabLike): string | null {
    const tabId = tab.id ?? tab.tabId ?? tab.tabID;
    return typeof tabId === "string" && tabId.trim() ? tabId : null;
  }

  private shouldTrackTab(tab: RuntimeTabLike & { id?: string }): boolean {
    return !(
      tab.id === LIBRARY_TAB_ID ||
      tab.type === "library" ||
      tab.type === "zotero-pane"
    );
  }

  private toTrackedTab(
    tab: RuntimeTabLike & { id: string },
    nativeIndex: number,
    selectedID: string | null,
  ): TrackedTab {
    const itemID = this.extractItemID(tab);
    const parentItemID = this.extractParentItemID(itemID);
    const title = tab.title || this.extractFallbackTitle(tab);
    const isSelected = tab.id === selectedID || Boolean(tab.selected);

    return {
      key: this.makeTabKey(tab.id),
      tabId: tab.id,
      type: tab.type || "unknown",
      title,
      itemID,
      parentItemID,
      isOpen: true,
      isSelected,
      nativeIndex,
      openedAt: this.openedAtByTabId.get(tab.id) ?? null,
      iconKey: this.getIconKey(tab),
    };
  }

  private extractItemID(tab: RuntimeTabLike): number | null {
    const rawItemID = tab.data?.itemID ?? tab.data?.itemId;
    return typeof rawItemID === "number" ? rawItemID : null;
  }

  private extractParentItemID(itemID: number | null): number | null {
    if (itemID == null) {
      return null;
    }

    if (this.parentItemIDByItemID.has(itemID)) {
      return this.parentItemIDByItemID.get(itemID) ?? null;
    }

    try {
      const item = Zotero.Items.get(itemID);
      if (!item) {
        this.parentItemIDByItemID.set(itemID, null);
        return null;
      }

      const parentItemID = item.topLevelItem?.id ?? item.id ?? null;
      this.parentItemIDByItemID.set(itemID, parentItemID);
      return parentItemID;
    } catch (error) {
      ztoolkit.log("TabTrackerService failed to resolve parent item", error);
      this.parentItemIDByItemID.set(itemID, null);
      return null;
    }
  }

  private extractFallbackTitle(tab: RuntimeTabLike & { id: string }): string {
    if (typeof tab.data?.title === "string" && tab.data.title.trim()) {
      return tab.data.title;
    }
    return tab.id;
  }

  private getIconKey(tab: RuntimeTabLike): string {
    if (tab.type === "reader-unloaded") {
      return "reader";
    }
    return tab.type || "unknown";
  }

  private makeTabKey(tabId: string): string {
    return `tab:${tabId}`;
  }
}
