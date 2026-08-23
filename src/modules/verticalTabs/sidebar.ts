import { getString } from "../../utils/locale";
import {
  getGroupColorPalette,
  getPref,
  getVerticalTabStylePrefs,
} from "../../utils/prefs";
import TabTrackerService from "./tabTracker";
import TabCommandController, { TabCommandItem } from "./tabCommands";
import TabGroupStore from "./groupStore";
import {
  setCollapsibleMeasuredHeight,
  syncCollapsibleState,
} from "./collapsible";
import {
  AggregateSection,
  ContextMenuTarget,
  DeferredReaderLoadTab,
  DropPosition,
  InlineGroupNameEditor,
  RenderableGroup,
  SIDEBAR,
  SidebarElements,
  SidebarViewMode,
} from "./sidebarCommon";
import {
  commitGroupHeaderDrop,
  commitGroupMemberDrop,
  commitTabDrop,
  commitGroupMemberToTabDrop,
  commitTabToGroupDrop,
  createSidebarDragState,
  getDropPosition as resolveDropPosition,
  getSortableGroupHeaderFromEventTarget,
  getSortableRowFromEventTarget,
  isNoOpGroupHeaderDropTarget,
  isNoOpGroupMemberDropTarget,
  isNoOpTabDropTarget,
  resolveDropTargetFromPoint,
  resolveGroupHeaderDropTargetFromPoint,
  SidebarDragState,
  updateDropIndicator,
} from "./sidebarDrag";
import { mountSidebarLayout, removeSidebarLayout } from "./sidebarLayout";
import {
  isSidebarViewMode,
  persistGroupsState,
  persistSidebarState,
  restoreSidebarState,
} from "./sidebarPersistence";
import {
  LIBRARY_TAB_ID,
  TabTrackerSnapshot,
  TrackedTab,
  VirtualGroup,
  VirtualGroupMember,
} from "./types";
import SidebarMenuController from "./sidebarMenu";
import SidebarViewRenderer from "./sidebarView";

export default class VerticalTabSidebar {
  private readonly window: _ZoteroTypes.MainWindow;
  private readonly document: Document;
  private readonly tracker: TabTrackerService;
  private readonly commandController: TabCommandController;
  private readonly groupStore: TabGroupStore;
  private readonly menuController: SidebarMenuController;
  private readonly viewRenderer: SidebarViewRenderer;
  private initialized = false;
  private collapsed = false;
  private expandedWidth: number = SIDEBAR.DEFAULT_EXPANDED_WIDTH;
  private searchQuery = "";
  private viewMode: SidebarViewMode = "default";
  private sidebar?: XULElement;
  private splitter?: XULElement;
  private toggleButton?: XULElement;
  private createGroupButton?: HTMLButtonElement;
  private viewSwitcher?: HTMLElement;
  private headerTitle?: HTMLElement;
  private countBadge?: HTMLElement;
  private listContainer?: HTMLElement;
  private searchInput?: HTMLInputElement;
  private contextMenu?: XULPopupElement;
  private stylesheet?: HTMLElement;
  private unsubscribeTracker?: () => void;
  private unsubscribeGroupStore?: () => void;
  private trackedTabsByKey = new Map<string, TrackedTab>();
  private trackedTabsByMemberKey = new Map<string, TrackedTab>();
  private draggedTabKey: string | null = null;
  private draggedGroupId: string | null = null;
  private draggedMemberKey: string | null = null;
  private draggedHeaderGroupId: string | null = null;
  private dragOverTabKey: string | null = null;
  private dragOverGroupId: string | null = null;
  private dragOverMemberKey: string | null = null;
  private dragOverHeaderGroupId: string | null = null;
  private dragOverPosition: DropPosition | null = null;
  private pendingGroupToggleTimers = new Map<string, number>();
  private pendingMemberOpenPromises = new Map<string, Promise<boolean>>();
  private groupNameEditor: InlineGroupNameEditor | null = null;
  private readonly displayItemIDCache = new Map<string, number | null>();
  private readonly itemFieldCache = new Map<string, string>();
  private pendingRenderSnapshot: TabTrackerSnapshot | null = null;
  private pendingRenderTimer: number | null = null;
  private lastRenderedSnapshotStructure: string | null = null;
  private lastSelectedTabKey: string | null = null;
  private pendingReaderLoadRefreshTimer: number | null = null;
  private displayTitleMode = "title";
  private displaySubtitleMode = "source";
  private metadataDeferredUntil = 0;
  private metadataResumeTimer: number | null = null;
  private isResizing: boolean = false;

  private readonly handleResizeEnd = () => {
    if (!this.sidebar || this.collapsed || !this.isResizing) {
      return;
    }
    const width = Math.round(this.sidebar.getBoundingClientRect().width);
    if (width >= SIDEBAR.MIN_WIDTH) {
      this.expandedWidth = width;
      this.applySidebarWidth();
      this.persistSidebarState();
    }
    this.isResizing = false;
  };

  private readonly handleGlobalKeyDown = (event: KeyboardEvent) => {
    // Ctrl+B: Toggle sidebar visibility
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      // Don't toggle if user is typing in search input or other form elements
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.toggleCollapsed();
    }
  };

  private readonly handleListDragOver = (event: DragEvent) => {
    if (!this.listContainer) {
      return;
    }

    if (this.draggedHeaderGroupId) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      const header = this.getSortableGroupHeaderFromEventTarget(event.target);
      if (header) {
        return;
      }

      const target = this.resolveGroupHeaderDropTargetFromPoint(event.clientY);
      if (!target) {
        this.clearDropIndicator();
        return;
      }

      this.setGroupHeaderDropIndicator(target.groupId, target.position);
      return;
    }

    if (this.draggedGroupId && this.draggedMemberKey) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      const targetGroupId = this.getGroupIdFromEventTarget(event.target);
      if (
        targetGroupId &&
        targetGroupId === this.dragOverGroupId &&
        this.dragOverPosition
      ) {
        this.updateDropIndicator();
        return;
      }

      if (!targetGroupId && this.dragOverTabKey && this.dragOverPosition) {
        this.updateDropIndicator();
        return;
      }

      this.clearDropIndicator();
      return;
    }

    if (!this.draggedTabKey || this.draggedMemberKey) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const targetGroupId = this.getGroupIdFromEventTarget(event.target);
    if (
      targetGroupId &&
      targetGroupId === this.dragOverGroupId &&
      this.dragOverPosition
    ) {
      this.updateDropIndicator();
      return;
    }

    const row = this.getSortableRowFromEventTarget(event.target);
    if (row) {
      return;
    }

    const target = this.resolveDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDropIndicator();
      return;
    }

    this.setDropIndicator(target.tabKey, target.position);
  };

  private readonly handleListDrop = (event: DragEvent) => {
    if (!this.listContainer) {
      return;
    }

    if (this.draggedHeaderGroupId) {
      event.preventDefault();
      const header = this.getSortableGroupHeaderFromEventTarget(event.target);
      if (header) {
        this.commitGroupHeaderDrop(
          header.dataset.groupId ?? null,
          this.getDropPosition(header, event),
        );
        return;
      }

      const target = this.resolveGroupHeaderDropTargetFromPoint(event.clientY);
      if (!target) {
        this.clearDragState();
        return;
      }

      this.commitGroupHeaderDrop(target.groupId, target.position);
      return;
    }

    if (this.draggedGroupId && this.draggedMemberKey) {
      event.preventDefault();
      const targetGroupId = this.getGroupIdFromEventTarget(event.target);
      if (
        targetGroupId &&
        targetGroupId === this.dragOverGroupId &&
        this.dragOverPosition
      ) {
        this.commitGroupMemberDrop(
          targetGroupId,
          this.dragOverMemberKey,
          this.dragOverPosition,
        );
        return;
      }

      if (!targetGroupId && this.dragOverTabKey && this.dragOverPosition) {
        this.commitGroupMemberToTabDrop(
          this.dragOverTabKey,
          this.dragOverPosition,
        );
        return;
      }

      this.clearDragState();
      return;
    }

    if (!this.draggedTabKey || this.draggedMemberKey) {
      return;
    }

    event.preventDefault();
    const targetGroupId = this.getGroupIdFromEventTarget(event.target);
    if (
      targetGroupId &&
      targetGroupId === this.dragOverGroupId &&
      this.dragOverPosition
    ) {
      this.commitTabToGroupDrop(
        targetGroupId,
        this.dragOverMemberKey,
        this.dragOverPosition,
      );
      return;
    }

    const row = this.getSortableRowFromEventTarget(event.target);
    if (row) {
      this.commitDrop(
        row.dataset.tabKey ?? null,
        this.getDropPosition(row, event),
      );
      return;
    }

    const target = this.resolveDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDragState();
      return;
    }

    this.commitDrop(target.tabKey, target.position);
  };

  private readonly handleWindowDragEnd = () => {
    this.clearDragState();
  };

  constructor(window: _ZoteroTypes.MainWindow, tracker: TabTrackerService) {
    this.window = window;
    this.document = window.document;
    this.tracker = tracker;
    this.commandController = new TabCommandController(window);
    this.groupStore = new TabGroupStore(window);
    this.menuController = new SidebarMenuController(
      this.document,
      this.commandController,
      this.groupStore,
      {
        getTrackedTabByKey: (tabKey) =>
          this.trackedTabsByKey.get(tabKey) ?? null,
        getTrackedTabByMemberKey: (memberKey) =>
          this.trackedTabsByMemberKey.get(memberKey) ?? null,
      },
      {
        beginCreateGroupEditor: (tab) => this.beginCreateGroupEditor(tab),
        beginRenameGroupEditor: (groupId) => {
          const group = this.groupStore.findGroupById(groupId);
          if (group) {
            this.beginRenameGroupEditor(group);
          }
        },
        openGroupMembers: (groupId, options) =>
          this.openGroupMembers(groupId, options),
        closeGroupMembers: (groupId) => this.closeGroupMembers(groupId),
      },
    );
    this.viewRenderer = new SidebarViewRenderer(
      this.window,
      this.document,
      this.groupStore,
    );
  }

  public init(): void {
    if (this.initialized) {
      ztoolkit.log("VerticalTabSidebar already initialized, skipping");
      return;
    }

    if (!this.mountLayout()) {
      ztoolkit.log("VerticalTabSidebar failed to mount");
      return;
    }

    this.restorePersistedState();
    this.refreshDisplayModeCache();
    this.applyDisplayStylePrefs();
    this.initialized = true;
    this.unsubscribeGroupStore = this.groupStore.subscribe(() => {
      if (this.initialized) {
        this.persistGroupsState();
        this.requestRender(this.tracker.getSnapshot());
      }
    });
    this.lastSelectedTabKey = this.tracker.getSnapshot().selectedTabKey;
    this.unsubscribeTracker = this.tracker.subscribe((snapshot) => {
      const normalizedTabs = snapshot.tabs.map((tab) => this.normalizeTab(tab));
      const selectionChanged =
        snapshot.selectedTabKey !== this.lastSelectedTabKey;
      this.lastSelectedTabKey = snapshot.selectedTabKey;
      if (selectionChanged) {
        const selectedTab = normalizedTabs.find(
          (tab) => tab.key === snapshot.selectedTabKey,
        );
        if (selectedTab) {
          this.groupStore.expandGroupsContainingTab(selectedTab);
        }
      }
      if (this.applySelectionOnlyUpdate(snapshot, normalizedTabs)) {
        return;
      }

      const groupSyncChanged = this.groupStore.syncTrackedTabs(normalizedTabs);
      if (!groupSyncChanged) {
        this.requestRender(snapshot);
      }
    });
    this.window.addEventListener("mouseup", this.handleResizeEnd);
    this.window.addEventListener("dragend", this.handleWindowDragEnd, true);
    this.window.addEventListener("keydown", this.handleGlobalKeyDown, true);
    ztoolkit.log("VerticalTabSidebar initialized");
  }

  public refreshDisplayPrefs(): void {
    if (!this.initialized) {
      return;
    }
    this.refreshDisplayModeCache();
    this.applyDisplayStylePrefs();
    this.clearDisplayMetadataCache();
    this.render(this.tracker.getSnapshot());
  }

  public deferReaderMetadata(
    duration = SIDEBAR.READER_METADATA_DEFER_MS,
  ): void {
    if (!this.initialized) {
      return;
    }

    this.metadataDeferredUntil = Math.max(
      this.metadataDeferredUntil,
      Date.now() + duration,
    );
    this.scheduleMetadataResumeRender();
  }

  public handleDeferredReaderLoad(tabs: DeferredReaderLoadTab[]): boolean {
    if (
      !this.initialized ||
      !tabs.length ||
      !this.patchLoadedReaderRows(tabs)
    ) {
      return false;
    }

    this.scheduleDeferredReaderLoadRefresh();
    return true;
  }

  public getGroupsForContextMenu(): VirtualGroup[] {
    return this.groupStore.getGroups();
  }

  public addOpenTabToGroup(tabId: string | null, groupId: string): boolean {
    if (!tabId || !groupId) {
      return false;
    }

    const trackedTab = this.tracker
      .getTabs()
      .map((tab) => this.normalizeTab(tab))
      .find((tab) => tab.tabId === tabId && this.shouldRenderTab(tab));
    if (!trackedTab) {
      this.tracker.requestReconcile(`horizontal-add-to-group:${tabId}`, 0);
      return false;
    }

    this.groupStore.addTabToGroup(groupId, trackedTab);
    return true;
  }

  public createGroupFromOpenTab(tabId: string | null, name?: string): boolean {
    const trackedTab = this.findTrackedTabByTabId(tabId);
    if (!trackedTab) {
      if (tabId) {
        this.tracker.requestReconcile(`horizontal-create-group:${tabId}`, 0);
      }
      return false;
    }

    this.groupStore.createGroupFromTab(trackedTab, name);
    return true;
  }

  public async openItemsIntoGroup(
    items: any[],
    groupId: string,
  ): Promise<boolean> {
    if (!groupId || !this.groupStore.findGroupById(groupId)) {
      return false;
    }

    const trackedTabs = await this.openItemsAsTrackedTabs(items);
    if (!trackedTabs.length) {
      return false;
    }

    trackedTabs.forEach((tab) => {
      this.groupStore.addTabToGroup(groupId, tab);
    });
    this.tracker.scheduleDelayedReconcile(
      `item-menu-open-into-group:${groupId}`,
      [120, 360, 720],
    );
    return true;
  }

  public async openItemsInNewGroup(
    items: any[],
    name = getString("new-group"),
  ): Promise<boolean> {
    const trackedTabs = await this.openItemsAsTrackedTabs(items);
    if (!trackedTabs.length) {
      return false;
    }

    this.groupStore.createGroupFromTabs(trackedTabs, name);
    this.tracker.scheduleDelayedReconcile("item-menu-open-new-group", [
      120,
      360,
      720,
    ]);
    return true;
  }

  public destroy(): void {
    if (!this.initialized) {
      return;
    }

    if (!addon.data.resettingPluginData) {
      this.persistSidebarState();
      this.persistGroupsState();
    }

    this.unsubscribeTracker?.();
    this.unsubscribeTracker = undefined;
    this.unsubscribeGroupStore?.();
    this.unsubscribeGroupStore = undefined;
    this.cancelPendingRender();
    this.cancelMetadataResumeRender();
    this.cancelDeferredReaderLoadRefresh();
    this.pendingGroupToggleTimers.forEach((timerId) => {
      this.window.clearTimeout(timerId);
    });
    this.pendingGroupToggleTimers.clear();
    this.pendingMemberOpenPromises.clear();
    this.window.removeEventListener("mouseup", this.handleResizeEnd);
    this.window.removeEventListener("dragend", this.handleWindowDragEnd, true);
    this.window.removeEventListener("keydown", this.handleGlobalKeyDown, true);

    removeSidebarLayout({
      sidebar: this.sidebar,
      splitter: this.splitter,
      contextMenu: this.contextMenu,
      stylesheet: this.stylesheet,
    });
    this.sidebar = undefined;
    this.splitter = undefined;
    this.toggleButton = undefined;
    this.createGroupButton = undefined;
    this.viewSwitcher = undefined;
    this.headerTitle = undefined;
    this.countBadge = undefined;
    this.listContainer = undefined;
    this.searchInput = undefined;
    this.contextMenu = undefined;
    this.stylesheet = undefined;
    this.groupNameEditor = null;
    this.trackedTabsByKey.clear();
    this.trackedTabsByMemberKey.clear();
    this.lastRenderedSnapshotStructure = null;
    this.lastSelectedTabKey = null;
    this.clearDisplayMetadataCache();
    this.groupStore.destroy();
    this.clearDragState();
    this.initialized = false;
    ztoolkit.log("VerticalTabSidebar destroyed");
  }

  private mountLayout(): boolean {
    const elements = mountSidebarLayout({
      window: this.window,
      document: this.document,
      onToggleCollapsed: () => this.toggleCollapsed(),
      onCreateGroupFromUngroupedTabs: () => this.createGroupFromUngroupedTabs(),
      onSearchInput: (value) => {
        this.searchQuery = value.trim().toLocaleLowerCase();
        this.persistSidebarState();
        this.render(this.tracker.getSnapshot());
      },
      onViewModeChange: (mode) => this.setViewMode(mode),
      onListDragOver: this.handleListDragOver,
      onListDrop: this.handleListDrop,
      onResizeStart: () => {
        this.isResizing = true;
      },
    });
    if (!elements) {
      return false;
    }
    this.assignMountedElements(elements);
    this.applySidebarWidth();
    return true;
  }

  private assignMountedElements(elements: SidebarElements): void {
    this.sidebar = elements.sidebar;
    this.splitter = elements.splitter;
    this.toggleButton = elements.toggleButton;
    this.createGroupButton = elements.createGroupButton;
    this.viewSwitcher = elements.viewSwitcher;
    this.headerTitle = elements.headerTitle;
    this.countBadge = elements.countBadge;
    this.listContainer = elements.listContainer;
    this.searchInput = elements.searchInput;
    this.contextMenu = elements.contextMenu;
    this.stylesheet = elements.stylesheet;
  }

  private getDragState(): SidebarDragState {
    return {
      draggedTabKey: this.draggedTabKey,
      draggedGroupId: this.draggedGroupId,
      draggedMemberKey: this.draggedMemberKey,
      draggedHeaderGroupId: this.draggedHeaderGroupId,
      dragOverTabKey: this.dragOverTabKey,
      dragOverGroupId: this.dragOverGroupId,
      dragOverMemberKey: this.dragOverMemberKey,
      dragOverHeaderGroupId: this.dragOverHeaderGroupId,
      dragOverPosition: this.dragOverPosition,
    };
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.hideContextMenu();
    this.applySidebarWidth();
    this.persistSidebarState();
    this.render(this.tracker.getSnapshot());
  }

  private setViewMode(mode: SidebarViewMode): void {
    if (this.viewMode === mode) {
      this.updateViewSwitcher();
      return;
    }

    this.viewMode = mode;
    this.hideContextMenu();
    this.clearDragState();
    this.persistSidebarState();
    this.render(this.tracker.getSnapshot());
  }

  private updateViewSwitcher(): void {
    if (!this.viewSwitcher) {
      return;
    }

    const buttons = this.viewSwitcher.querySelectorAll(
      ".tab-enhance-vertical-tabs-view-button",
    );
    buttons.forEach((node: Element) => {
      const button = node as HTMLButtonElement;
      const mode = button.dataset.viewMode as SidebarViewMode | undefined;
      const isActive = mode === this.viewMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  private applySidebarWidth(): void {
    if (!this.sidebar || !this.splitter) {
      return;
    }

    this.toggleButton?.setAttribute("label", this.collapsed ? ">" : "<");

    if (this.collapsed) {
      this.sidebar.classList.add("is-collapsed");
      this.sidebar.style.width = `${SIDEBAR.COLLAPSED_WIDTH}px`;
      this.splitter.setAttribute("hidden", "true");
    } else {
      this.sidebar.classList.remove("is-collapsed");
      this.sidebar.style.width = `${this.expandedWidth}px`;
      this.splitter.removeAttribute("hidden");
    }
  }

  private restorePersistedState(): void {
    const restoredState = restoreSidebarState({
      searchInput: this.searchInput,
      groupStore: this.groupStore,
    });
    this.collapsed = restoredState.collapsed;
    this.expandedWidth = restoredState.expandedWidth;
    this.searchQuery = restoredState.searchQuery;
    this.viewMode = restoredState.viewMode;
    this.applySidebarWidth();
    this.updateViewSwitcher();
  }

  private persistSidebarState(): void {
    persistSidebarState({
      collapsed: this.collapsed,
      width: this.expandedWidth,
      searchQuery: this.searchQuery,
      selectedKeys: [],
      viewMode: this.viewMode,
    });
  }

  private persistGroupsState(): void {
    persistGroupsState(this.groupStore);
  }

  private isSidebarViewMode(value: unknown): value is SidebarViewMode {
    return isSidebarViewMode(value);
  }

  private requestRender(snapshot: TabTrackerSnapshot): void {
    this.pendingRenderSnapshot = snapshot;
    if (this.pendingRenderTimer != null) {
      return;
    }

    this.pendingRenderTimer = this.window.setTimeout(() => {
      this.pendingRenderTimer = null;
      const pendingSnapshot = this.pendingRenderSnapshot;
      this.pendingRenderSnapshot = null;
      if (!this.initialized || !pendingSnapshot) {
        return;
      }
      this.render(pendingSnapshot);
    }, SIDEBAR.RENDER_DEBOUNCE_MS);
  }

  private cancelPendingRender(): void {
    if (this.pendingRenderTimer != null) {
      this.window.clearTimeout(this.pendingRenderTimer);
      this.pendingRenderTimer = null;
    }
    this.pendingRenderSnapshot = null;
  }

  private applySelectionOnlyUpdate(
    snapshot: TabTrackerSnapshot,
    normalizedTabs: TrackedTab[],
  ): boolean {
    if (
      this.pendingRenderTimer != null ||
      !this.listContainer ||
      this.groupNameEditor ||
      this.draggedTabKey ||
      this.draggedGroupId ||
      this.draggedMemberKey ||
      this.draggedHeaderGroupId
    ) {
      return false;
    }

    const snapshotStructure = this.getSnapshotStructure(snapshot);
    if (
      !this.lastRenderedSnapshotStructure ||
      snapshotStructure !== this.lastRenderedSnapshotStructure
    ) {
      return false;
    }

    this.refreshTrackedTabMaps(
      normalizedTabs.filter((tab) => this.shouldRenderTab(tab)),
    );
    this.updateSelectedRows(snapshot.selectedTabKey);
    return true;
  }

  private updateSelectedRows(selectedTabKey: string | null): void {
    if (!this.listContainer) {
      return;
    }

    this.listContainer
      .querySelectorAll<HTMLElement>(
        ".tab-enhance-vertical-tab-row[data-tab-key]",
      )
      .forEach((row: HTMLElement) => {
        const tabKey = row.dataset.tabKey ?? null;
        const isSelected = selectedTabKey
          ? tabKey === selectedTabKey
          : Boolean(tabKey && this.trackedTabsByKey.get(tabKey)?.isSelected);
        row.classList.toggle("is-selected", isSelected);
        row.setAttribute("aria-selected", isSelected ? "true" : "false");
        row.setAttribute("tabindex", isSelected ? "0" : "-1");
      });
  }

  private patchLoadedReaderRows(tabs: DeferredReaderLoadTab[]): boolean {
    if (!this.listContainer) {
      return false;
    }

    const snapshotTabs = this.tracker
      .getSnapshot()
      .tabs.map((tab) => this.normalizeTab(tab));
    let patched = false;

    tabs.forEach((loadedTab) => {
      const nextTab = this.normalizeTab({
        ...(snapshotTabs.find((tab) => tab.tabId === loadedTab.tabId) ?? {
          key: `tab:${loadedTab.tabId}`,
          tabId: loadedTab.tabId,
          type: "reader",
          title: loadedTab.title ?? loadedTab.tabId,
          itemID: loadedTab.itemID ?? null,
          parentItemID: null,
          isOpen: true,
          isSelected: this.window.Zotero_Tabs.selectedID === loadedTab.tabId,
          nativeIndex: 0,
          openedAt: null,
          iconKey: "reader",
        }),
        tabId: loadedTab.tabId,
        type: loadedTab.type ?? "reader",
        title: loadedTab.title?.trim() || loadedTab.tabId,
        itemID: loadedTab.itemID ?? null,
        iconKey: "reader",
      });
      const row = this.listContainer?.querySelector<HTMLElement>(
        `.tab-enhance-vertical-tab-row[data-tab-id="${CSS.escape(loadedTab.tabId)}"]`,
      );
      if (!row) {
        return;
      }

      row.dataset.tabKey = nextTab.key;
      row.dataset.tabId = loadedTab.tabId;
      row.dataset.nativeIndex = String(nextTab.nativeIndex);
      row.title = nextTab.title;
      row.replaceChildren(this.renderBadge(nextTab.iconKey));
      if (!this.collapsed) {
        row.appendChild(
          this.renderRowContent(
            this.getDisplayTitle(nextTab),
            this.getDisplaySubtitle(nextTab),
          ),
        );
        row.appendChild(
          this.renderCloseButton(() => {
            this.commandController.close(nextTab.tabId);
          }),
        );
      }
      patched = true;
    });

    if (patched) {
      const patchedTabsById = new Map(tabs.map((tab) => [tab.tabId, tab]));
      this.refreshTrackedTabMaps(
        snapshotTabs
          .map((tab) => {
            const patchedTab = patchedTabsById.get(tab.tabId ?? "");
            if (!patchedTab) {
              return tab;
            }
            return this.normalizeTab({
              ...tab,
              type: patchedTab.type ?? "reader",
              title: patchedTab.title?.trim() || tab.title,
              itemID: patchedTab.itemID ?? tab.itemID,
              iconKey: "reader",
            });
          })
          .filter((tab) => this.shouldRenderTab(tab)),
      );
      this.updateSelectedRows(
        this.window.Zotero_Tabs.selectedID
          ? `tab:${this.window.Zotero_Tabs.selectedID}`
          : null,
      );
    }

    return patched;
  }

  private isMetadataDeferred(): boolean {
    return Date.now() < this.metadataDeferredUntil;
  }

  private scheduleMetadataResumeRender(): void {
    this.cancelMetadataResumeRender();
    const delay = Math.max(0, this.metadataDeferredUntil - Date.now());
    this.metadataResumeTimer = this.window.setTimeout(() => {
      this.metadataResumeTimer = null;
      if (!this.initialized || this.isMetadataDeferred()) {
        return;
      }
      this.render(this.tracker.getSnapshot());
    }, delay);
  }

  private cancelMetadataResumeRender(): void {
    if (this.metadataResumeTimer != null) {
      this.window.clearTimeout(this.metadataResumeTimer);
      this.metadataResumeTimer = null;
    }
  }

  private scheduleDeferredReaderLoadRefresh(): void {
    this.cancelDeferredReaderLoadRefresh();
    const delay = Math.max(0, this.metadataDeferredUntil - Date.now());
    this.pendingReaderLoadRefreshTimer = this.window.setTimeout(() => {
      this.pendingReaderLoadRefreshTimer = null;
      if (!this.initialized) {
        return;
      }
      this.tracker.requestReconcile("deferred-reader-load", 0);
    }, delay);
  }

  private cancelDeferredReaderLoadRefresh(): void {
    if (this.pendingReaderLoadRefreshTimer != null) {
      this.window.clearTimeout(this.pendingReaderLoadRefreshTimer);
      this.pendingReaderLoadRefreshTimer = null;
    }
  }

  private render(snapshot: TabTrackerSnapshot): void {
    this.cancelPendingRender();
    const openTabs = snapshot.tabs
      .map((tab) => this.normalizeTab(tab))
      .filter((tab) => this.shouldRenderTab(tab));
    this.refreshTrackedTabMaps(openTabs);
    this.lastRenderedSnapshotStructure = this.getSnapshotStructure(snapshot);
    this.viewRenderer.render(
      snapshot,
      {
        collapsed: this.collapsed,
        searchQuery: this.searchQuery,
        viewMode: this.viewMode,
        selectedTabKey: snapshot.selectedTabKey,
        groupNameEditor: this.groupNameEditor,
        draggedTabKey: this.draggedTabKey,
        draggedGroupId: this.draggedGroupId,
        draggedMemberKey: this.draggedMemberKey,
        draggedHeaderGroupId: this.draggedHeaderGroupId,
        dragOverTabKey: this.dragOverTabKey,
        dragOverGroupId: this.dragOverGroupId,
        dragOverMemberKey: this.dragOverMemberKey,
        dragOverHeaderGroupId: this.dragOverHeaderGroupId,
        dragOverPosition: this.dragOverPosition,
        metadataDeferred: this.isMetadataDeferred(),
        trackedTabsByKey: this.trackedTabsByKey,
        trackedTabsByMemberKey: this.trackedTabsByMemberKey,
      },
      {
        listContainer: this.listContainer,
        countBadge: this.countBadge,
        headerTitle: this.headerTitle,
      },
      {
        hideContextMenu: () => this.hideContextMenu(),
        updateViewSwitcher: () => this.updateViewSwitcher(),
        clearDragState: () => this.clearDragState(),
        requestGroupCollapsedToggle: (groupId, collapsed, container) =>
          this.requestGroupCollapsedToggle(groupId, collapsed, container),
        rowClick: this.handleRowClick,
        rowKeyDown: this.handleRowKeyDown,
        rowContextMenu: this.handleRowContextMenu,
        virtualMemberContextMenu: this.handleVirtualMemberContextMenu,
        virtualMemberClick: this.handleVirtualMemberClick,
        virtualMemberKeyDown: this.handleVirtualMemberKeyDown,
        rowDragStart: this.handleRowDragStart,
        rowDragOver: this.handleRowDragOver,
        rowDrop: this.handleRowDrop,
        rowDragEnd: this.handleRowDragEnd,
        groupHeaderDragStart: this.handleGroupHeaderDragStart,
        groupHeaderDragOver: this.handleGroupHeaderDragOver,
        groupHeaderDrop: this.handleGroupHeaderDrop,
        groupHeaderDragEnd: this.handleGroupHeaderDragEnd,
        groupHeaderContextMenu: this.handleGroupHeaderContextMenu,
        groupNameEditorInput: (value) => {
          if (this.groupNameEditor) {
            this.groupNameEditor.value = value;
          }
        },
        commitInlineGroupNameEditor: () => this.commitInlineGroupNameEditor(),
        cancelInlineGroupNameEditor: () => this.cancelInlineGroupNameEditor(),
        closeTab: (tabId) => this.commandController.close(tabId),
      },
    );
  }

  private refreshTrackedTabMaps(openTabs: TrackedTab[]): void {
    this.trackedTabsByKey.clear();
    this.trackedTabsByMemberKey.clear();
    openTabs.forEach((tab) => {
      this.trackedTabsByKey.set(tab.key, tab);
      this.groupStore.getMemberLookupKeysFromTab(tab).forEach((key) => {
        if (!this.trackedTabsByMemberKey.has(key)) {
          this.trackedTabsByMemberKey.set(key, tab);
        }
      });
    });
  }

  private getSnapshotStructure(snapshot: TabTrackerSnapshot): string {
    return snapshot.tabs
      .map((tab) =>
        [
          tab.key,
          tab.tabId ?? "",
          tab.type,
          tab.title,
          tab.itemID ?? "",
          tab.parentItemID ?? "",
          tab.isOpen ? "1" : "0",
          tab.nativeIndex,
          tab.openedAt ?? "",
          tab.iconKey,
        ].join("\u001f"),
      )
      .join("\u001e");
  }

  private getViewTitle(): string {
    switch (this.viewMode) {
      case "recent":
        return getString("view-recent");
      case "type":
        return getString("view-type");
      default:
        return getString("view-default");
    }
  }

  private getAggregateSections(openTabs: TrackedTab[]): AggregateSection[] {
    const filteredTabs = openTabs.filter((tab) => this.matchesSearch(tab));
    if (this.viewMode === "recent") {
      return this.buildRecentSections(filteredTabs);
    }
    if (this.viewMode === "type") {
      return this.buildTypeSections(filteredTabs);
    }
    return [];
  }

  private buildRecentSections(tabs: TrackedTab[]): AggregateSection[] {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sections: AggregateSection[] = [
      { id: "recent-now", title: getString("recent-just-now"), tabs: [] },
      { id: "recent-today", title: getString("recent-today"), tabs: [] },
      { id: "recent-earlier", title: getString("recent-earlier"), tabs: [] },
    ];

    tabs
      .slice()
      .sort((left, right) => (right.openedAt ?? 0) - (left.openedAt ?? 0))
      .forEach((tab) => {
        const openedAt = tab.openedAt ?? 0;
        if (openedAt && now - openedAt <= 10 * 60 * 1000) {
          sections[0].tabs.push(tab);
          return;
        }
        if (openedAt && openedAt >= startOfToday.getTime()) {
          sections[1].tabs.push(tab);
          return;
        }
        sections[2].tabs.push(tab);
      });

    return sections;
  }

  private buildTypeSections(tabs: TrackedTab[]): AggregateSection[] {
    const sectionMap = new Map<string, AggregateSection>();
    tabs.forEach((tab) => {
      const sectionId = tab.type || "unknown";
      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, {
          id: `type-${sectionId}`,
          title: this.getTypeSectionTitle(sectionId),
          tabs: [],
        });
      }
      sectionMap.get(sectionId)?.tabs.push(tab);
    });

    return Array.from(sectionMap.values()).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }

  private getTypeSectionTitle(type: string): string {
    switch (type) {
      case "reader":
      case "reader-unloaded":
        return getString("type-reader");
      case "note":
        return getString("type-note");
      case "web":
        return getString("type-web");
      default:
        return getString("type-other", { args: { type } });
    }
  }

  private renderAggregateSection(
    section: AggregateSection,
    selectedTabKey: string | null,
  ): HTMLElement {
    const container = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-aggregate-section"],
    }) as HTMLDivElement;

    const header = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-aggregate-header"],
    }) as HTMLDivElement;

    const title = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-aggregate-title"],
      properties: {
        textContent: section.title,
      },
    }) as HTMLSpanElement;

    const count = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-aggregate-count"],
      properties: {
        textContent: String(section.tabs.length),
      },
    }) as HTMLSpanElement;

    header.appendChild(title);
    header.appendChild(count);
    container.appendChild(header);

    section.tabs.forEach((tab) => {
      container.appendChild(
        this.renderTabRow(tab, selectedTabKey, {
          sortable: false,
          grouped: false,
        }),
      );
    });

    return container;
  }

  private renderGroupSection(
    renderable: RenderableGroup,
    selectedTabKey: string | null,
  ): HTMLElement {
    const container = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group"],
    }) as HTMLDivElement;
    container.dataset.groupId = renderable.group.id;
    container.style.setProperty("--group-color", renderable.group.color);
    container.classList.toggle("is-expanded", !renderable.group.collapsed);
    container.classList.toggle("is-collapsed", renderable.group.collapsed);
    const isEditingGroupName =
      this.groupNameEditor?.kind === "rename" &&
      this.groupNameEditor.groupId === renderable.group.id;

    const header = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-header"],
      properties: {
        title: renderable.group.name,
        draggable: !isEditingGroupName,
      },
      attributes: {
        role: "button",
        tabindex: "0",
      },
      listeners: [
        {
          type: "click",
          listener: (event: Event) => {
            if (isEditingGroupName) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.requestGroupCollapsedToggle(
              renderable.group.id,
              renderable.group.collapsed,
              container,
            );
          },
        },
        {
          type: "keydown",
          listener: (event: Event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (isEditingGroupName) {
              return;
            }
            if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") {
              return;
            }
            keyboardEvent.preventDefault();
            keyboardEvent.stopPropagation();
            this.requestGroupCollapsedToggle(
              renderable.group.id,
              renderable.group.collapsed,
              container,
            );
          },
        },
        {
          type: "contextmenu",
          listener: (event: Event) => {
            const mouseEvent = event as MouseEvent;
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
            this.showContextMenu(
              { kind: "group-header", groupId: renderable.group.id },
              mouseEvent.screenX,
              mouseEvent.screenY,
            );
          },
        },
        {
          type: "dragstart",
          listener: this.handleGroupHeaderDragStart,
        },
        {
          type: "dragover",
          listener: this.handleGroupHeaderDragOver,
        },
        {
          type: "drop",
          listener: this.handleGroupHeaderDrop,
        },
        {
          type: "dragend",
          listener: this.handleGroupHeaderDragEnd,
        },
      ],
    }) as HTMLDivElement;

    header.dataset.groupId = renderable.group.id;
    header.dataset.sortable = isEditingGroupName ? "false" : "true";
    header.dataset.sortKind = "groups";
    if (renderable.group.id === this.draggedHeaderGroupId) {
      header.classList.add("is-dragging");
    }

    const chevron = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-chevron"],
      properties: {
        textContent: renderable.group.collapsed ? "▸" : "▾",
      },
    }) as HTMLSpanElement;

    const colorChip = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-color"],
    }) as HTMLSpanElement;

    const title = isEditingGroupName
      ? this.renderInlineGroupNameEditor()
      : (ztoolkit.UI.createElement(this.document, "span", {
          namespace: "html",
          classList: ["tab-enhance-vertical-group-title"],
          properties: {
            textContent: renderable.group.name,
          },
        }) as HTMLSpanElement);

    const count = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-count"],
      properties: {
        textContent: String(renderable.group.members.length),
      },
    }) as HTMLSpanElement;

    header.appendChild(chevron);
    header.appendChild(colorChip);
    header.appendChild(title);
    header.appendChild(count);
    container.appendChild(header);

    const members = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-members"],
      attributes: {
        "aria-hidden": renderable.group.collapsed ? "true" : "false",
      },
    }) as HTMLDivElement;
    setCollapsibleMeasuredHeight(
      members,
      `${Math.max(SIDEBAR.ROW_HEIGHT, renderable.members.length * SIDEBAR.ROW_HEIGHT)}px`,
    );
    this.applyGroupMembersVisibility(members, renderable.group.collapsed);

    renderable.members.forEach((member) => {
      if (
        renderable.group.id === this.dragOverGroupId &&
        member.key === this.dragOverMemberKey &&
        this.dragOverPosition === "before"
      ) {
        members.appendChild(this.renderDropPlaceholder());
      }

      members.appendChild(
        this.renderGroupMemberRow(member, renderable.group.id, selectedTabKey),
      );

      if (
        renderable.group.id === this.dragOverGroupId &&
        member.key === this.dragOverMemberKey &&
        this.dragOverPosition === "after"
      ) {
        members.appendChild(this.renderDropPlaceholder());
      }
    });

    container.appendChild(members);

    return container;
  }

  private requestGroupCollapsedToggle(
    groupId: string,
    isCurrentlyCollapsed: boolean,
    container: HTMLDivElement,
  ): void {
    if (this.pendingGroupToggleTimers.has(groupId)) {
      return;
    }

    const nextCollapsed = !isCurrentlyCollapsed;
    const chevron = container.querySelector(
      ".tab-enhance-vertical-group-chevron",
    ) as HTMLSpanElement | null;
    const members = container.querySelector(
      ".tab-enhance-vertical-group-members",
    ) as HTMLDivElement | null;

    if (chevron) {
      chevron.textContent = nextCollapsed ? "▸" : "▾";
    }
    if (members) {
      members.setAttribute("aria-hidden", nextCollapsed ? "true" : "false");
      this.applyGroupMembersVisibility(members, nextCollapsed);
    }

    container.classList.add("is-transitioning");
    container.classList.toggle("is-expanded", !nextCollapsed);
    container.classList.toggle("is-collapsed", nextCollapsed);

    const timerId = this.window.setTimeout(() => {
      this.pendingGroupToggleTimers.delete(groupId);
      this.groupStore.toggleCollapsed(groupId);
    }, SIDEBAR.ANIMATION_DURATION_MS);
    this.pendingGroupToggleTimers.set(groupId, timerId);
  }

  private applyGroupMembersVisibility(
    members: HTMLDivElement,
    collapsed: boolean,
  ): void {
    syncCollapsibleState(members, collapsed);
  }
  private getRenderableGroups(openTabs: TrackedTab[]): RenderableGroup[] {
    const groups = this.groupStore.getGroups();

    return groups
      .map((group) => {
        const groupNameMatches = this.matchesGroupName(group.name);
        const members = group.members.filter((member) => {
          if (groupNameMatches || !this.searchQuery) {
            return true;
          }

          const liveTab = this.findTrackedTabByMemberKey(member.key);
          return this.matchesGroupMember(liveTab ?? member);
        });

        if (!groupNameMatches && members.length === 0) {
          return null;
        }

        return {
          group,
          members: members.map((member) => {
            const liveTab = this.findTrackedTabByMemberKey(member.key);
            return liveTab
              ? {
                  ...member,
                  sourceTabKey: liveTab.key,
                  tabId: liveTab.tabId,
                  title: liveTab.title,
                  type: liveTab.type,
                  itemID: liveTab.itemID,
                  parentItemID: liveTab.parentItemID,
                  isOpen: true,
                  openedAt: liveTab.openedAt,
                  iconKey: liveTab.iconKey,
                }
              : member;
          }),
        };
      })
      .filter((group): group is RenderableGroup => Boolean(group));
  }

  private getVisibleSortableTabs(snapshot: TabTrackerSnapshot): TrackedTab[] {
    return this.viewRenderer.getVisibleSortableTabs(snapshot, this.searchQuery);
  }

  private renderDropPlaceholder(): HTMLElement {
    return ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-placeholder"],
      attributes: {
        "aria-hidden": "true",
      },
    }) as HTMLDivElement;
  }

  private renderCreateGroupEditor(): HTMLElement {
    const palette = getGroupColorPalette();
    const groupColor =
      palette[this.groupStore.getGroups().length % palette.length] ?? "#F6B433";
    const container = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: [
        "tab-enhance-inline-group-create",
        "tab-enhance-vertical-group-header",
      ],
      properties: {
        title: getString("group-name-prompt"),
      },
      attributes: {
        role: "group",
      },
    }) as HTMLDivElement;

    container.style.setProperty("--group-color", groupColor);
    container.appendChild(
      ztoolkit.UI.createElement(this.document, "span", {
        namespace: "html",
        classList: ["tab-enhance-vertical-group-color"],
      }) as HTMLSpanElement,
    );
    container.appendChild(this.renderInlineGroupNameEditor());
    return container;
  }

  private renderInlineGroupNameEditor(): HTMLElement {
    const editor = this.groupNameEditor;
    const wrapper = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-inline-group-name-editor"],
      listeners: [
        {
          type: "click",
          listener: (event: Event) => event.stopPropagation(),
        },
        {
          type: "mousedown",
          listener: (event: Event) => event.stopPropagation(),
        },
        {
          type: "contextmenu",
          listener: (event: Event) => event.stopPropagation(),
        },
      ],
    }) as HTMLSpanElement;

    const input = ztoolkit.UI.createElement(this.document, "input", {
      namespace: "html",
      classList: ["tab-enhance-inline-group-name-input"],
      attributes: {
        type: "text",
        placeholder: getString("group-name-prompt"),
      },
      properties: {
        value: editor?.value ?? "",
      },
      listeners: [
        {
          type: "input",
          listener: (event: Event) => {
            if (this.groupNameEditor) {
              this.groupNameEditor.value = (
                event.target as HTMLInputElement
              ).value;
            }
          },
        },
        {
          type: "keydown",
          listener: (event: Event) => {
            const keyboardEvent = event as KeyboardEvent;
            keyboardEvent.stopPropagation();
            if (keyboardEvent.key === "Enter") {
              keyboardEvent.preventDefault();
              this.commitInlineGroupNameEditor();
              return;
            }
            if (keyboardEvent.key === "Escape") {
              keyboardEvent.preventDefault();
              this.cancelInlineGroupNameEditor();
            }
          },
        },
        {
          type: "blur",
          listener: () => {
            this.commitInlineGroupNameEditor();
          },
        },
      ],
    }) as HTMLInputElement;

    wrapper.appendChild(input);
    return wrapper;
  }

  private isNoOpDropTarget(
    targetTabKey: string | null,
    position: DropPosition | null,
    sourceTabKey = this.draggedTabKey,
  ): boolean {
    return isNoOpTabDropTarget({
      sourceTabKey,
      targetTabKey,
      position,
      visibleKeys: this.getVisibleSortableTabs(this.tracker.getSnapshot()).map(
        (tab) => tab.key,
      ),
    });
  }

  private isNoOpGroupMemberDropTarget(
    targetGroupId: string | null,
    targetMemberKey: string | null,
    position: DropPosition | null,
    sourceGroupId = this.draggedGroupId,
    sourceMemberKey = this.draggedMemberKey,
  ): boolean {
    return isNoOpGroupMemberDropTarget({
      sourceGroupId,
      sourceMemberKey,
      targetGroupId,
      targetMemberKey,
      position,
      visibleKeys:
        this.groupStore
          .findGroupById(targetGroupId ?? "")
          ?.members.map((member) => member.key) ?? [],
    });
  }

  private isNoOpGroupHeaderDropTarget(
    targetGroupId: string | null,
    position: DropPosition | null,
    sourceGroupId = this.draggedHeaderGroupId,
  ): boolean {
    return isNoOpGroupHeaderDropTarget({
      sourceGroupId,
      targetGroupId,
      position,
      visibleGroupIds: this.groupStore.getGroups().map((group) => group.id),
    });
  }

  private normalizeTab(tab: TrackedTab): TrackedTab {
    return this.viewRenderer.normalizeTab(tab);
  }

  private shouldRenderTab(tab: TrackedTab): boolean {
    return this.viewRenderer.shouldRenderTab(tab);
  }

  private matchesSearch(tab: TrackedTab): boolean {
    if (!this.searchQuery) {
      return true;
    }

    const haystack =
      `${tab.title} ${this.getDisplayTitle(tab)} ${this.getDisplaySubtitle(tab)} ${this.getMetaText(tab)}`.toLocaleLowerCase();
    return haystack.includes(this.searchQuery);
  }

  private matchesGroupName(name: string): boolean {
    if (!this.searchQuery) {
      return true;
    }

    return name.toLocaleLowerCase().includes(this.searchQuery);
  }

  private matchesGroupMember(
    member: Pick<
      VirtualGroupMember,
      "title" | "type" | "itemID" | "parentItemID" | "isOpen"
    >,
  ): boolean {
    if (!this.searchQuery) {
      return true;
    }

    const haystack =
      `${member.title} ${this.getDisplayTitle(member)} ${this.getDisplaySubtitle(member)} ${this.getVirtualMemberMetaText(member)}`.toLocaleLowerCase();
    return haystack.includes(this.searchQuery);
  }

  private renderTabRow(
    tab: TrackedTab,
    selectedTabKey: string | null,
    options: {
      sortable: boolean;
      grouped: boolean;
      groupId?: string;
      memberKey?: string;
    },
  ): HTMLElement {
    const isSelected = selectedTabKey
      ? tab.key === selectedTabKey
      : Boolean(tab.isSelected);

    const row = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-row"],
      properties: {
        title: tab.title,
        draggable: options.sortable,
      },
      attributes: {
        role: "button",
        tabindex: isSelected ? "0" : "-1",
      },
    }) as HTMLDivElement;

    row.dataset.tabKey = tab.key;
    if (tab.tabId) {
      row.dataset.tabId = tab.tabId;
    }
    row.dataset.nativeIndex = String(tab.nativeIndex);
    row.dataset.sortable = options.sortable ? "true" : "false";
    row.dataset.sortKind = options.groupId ? "group-members" : "tabs";
    row.dataset.grouped = options.grouped ? "true" : "false";
    if (options.groupId) {
      row.dataset.groupId = options.groupId;
      row.classList.add("is-group-member");
    }
    if (options.memberKey) {
      row.dataset.memberKey = options.memberKey;
    }

    row.addEventListener("click", this.handleRowClick);
    row.addEventListener("keydown", this.handleRowKeyDown);
    row.addEventListener("contextmenu", this.handleRowContextMenu);
    if (options.sortable) {
      row.addEventListener("dragstart", this.handleRowDragStart);
      row.addEventListener("dragover", this.handleRowDragOver);
      row.addEventListener("drop", this.handleRowDrop);
      row.addEventListener("dragend", this.handleRowDragEnd);
    }

    if (isSelected) {
      row.classList.add("is-selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }

    if (
      (tab.key === this.draggedTabKey && !options.groupId) ||
      (options.groupId && options.memberKey === this.draggedMemberKey)
    ) {
      row.classList.add("is-dragging");
    }

    row.appendChild(this.renderBadge(tab.iconKey));
    if (!this.collapsed) {
      row.appendChild(
        this.renderRowContent(
          this.getDisplayTitle(tab),
          this.getDisplaySubtitle(tab),
        ),
      );
    }

    if (!this.collapsed && tab.tabId) {
      row.appendChild(
        this.renderCloseButton(() => {
          this.commandController.close(tab.tabId);
        }),
      );
    }

    return row;
  }

  private renderGroupMemberRow(
    member: VirtualGroupMember,
    groupId: string,
    selectedTabKey: string | null,
  ): HTMLElement {
    const liveTab = this.trackedTabsByMemberKey.get(member.key) ?? null;
    if (liveTab) {
      return this.renderTabRow(liveTab, selectedTabKey, {
        sortable: true,
        grouped: true,
        groupId,
        memberKey: member.key,
      });
    }

    const row = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: [
        "tab-enhance-vertical-tab-row",
        "is-group-member",
        "is-virtual-member",
      ],
      properties: {
        title: member.title,
        draggable: true,
      },
      attributes: {
        role: "button",
        tabindex: "-1",
        "aria-selected": "false",
      },
    }) as HTMLDivElement;

    row.dataset.groupId = groupId;
    row.dataset.memberKey = member.key;
    row.dataset.sortable = "true";
    row.dataset.sortKind = "group-members";
    row.addEventListener("click", this.handleVirtualMemberClick);
    row.addEventListener("keydown", this.handleVirtualMemberKeyDown);
    row.addEventListener("contextmenu", this.handleVirtualMemberContextMenu);
    row.addEventListener("dragstart", this.handleRowDragStart);
    row.addEventListener("dragover", this.handleRowDragOver);
    row.addEventListener("drop", this.handleRowDrop);
    row.addEventListener("dragend", this.handleRowDragEnd);

    row.appendChild(this.renderBadge(member.iconKey));
    if (!this.collapsed) {
      row.appendChild(
        this.renderRowContent(
          this.getDisplayTitle(member),
          this.getDisplaySubtitle(member),
        ),
      );
    }

    return row;
  }

  private renderBadge(iconKey: string): HTMLElement {
    return ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-badge", `is-${iconKey}`],
      properties: {
        textContent: this.getBadgeText(iconKey),
      },
    }) as HTMLSpanElement;
  }

  private renderRowContent(titleText: string, metaText: string): HTMLElement {
    const content = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-content"],
    }) as HTMLSpanElement;

    const title = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-title"],
      properties: {
        textContent: titleText,
      },
    }) as HTMLSpanElement;

    const meta = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-meta"],
      properties: {
        textContent: metaText,
      },
    }) as HTMLSpanElement;

    content.appendChild(title);
    if (metaText.trim()) {
      content.appendChild(meta);
    }
    return content;
  }

  private renderCloseButton(handler: () => void): HTMLButtonElement {
    return ztoolkit.UI.createElement(this.document, "button", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-close"],
      properties: {
        textContent: "x",
        title: getString("close-tab"),
        draggable: false,
      },
      listeners: [
        {
          type: "click",
          listener: (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            handler();
          },
        },
      ],
    }) as HTMLButtonElement;
  }

  private readonly handleRowClick = (event: MouseEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const groupId = row.dataset.groupId ?? null;
    const memberKey = row.dataset.memberKey ?? null;
    const tabKey = row.dataset.tabKey ?? null;
    if (groupId && memberKey) {
      const trackedTab = tabKey ? this.trackedTabsByKey.get(tabKey) : null;
      if (!this.commandController.hasOpenTab(trackedTab?.tabId ?? null)) {
        void this.activateGroupMember(groupId, memberKey);
        return;
      }
    }

    this.selectTrackedTabByKey(row.dataset.tabKey ?? null);
  };

  private readonly handleRowKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.selectTrackedTabByKey(row.dataset.tabKey ?? null);
  };

  private readonly handleRowContextMenu = (event: MouseEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const groupId = row.dataset.groupId ?? null;
    const memberKey = row.dataset.memberKey ?? null;
    const target: ContextMenuTarget =
      groupId && memberKey
        ? { kind: "group-member", groupId, memberKey }
        : { kind: "tab", tabKey: row.dataset.tabKey ?? "" };
    this.showContextMenu(target, event.screenX, event.screenY);
  };

  private readonly handleVirtualMemberContextMenu = (event: MouseEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    const groupId = row?.dataset.groupId ?? null;
    const memberKey = row?.dataset.memberKey ?? null;
    if (!row || !groupId || !memberKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.showContextMenu(
      { kind: "group-member", groupId, memberKey },
      event.screenX,
      event.screenY,
    );
  };

  private readonly handleVirtualMemberClick = (event: MouseEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    const groupId = row?.dataset.groupId ?? null;
    const memberKey = row?.dataset.memberKey ?? null;
    if (!row || !groupId || !memberKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.activateGroupMember(groupId, memberKey);
  };

  private readonly handleVirtualMemberKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const row = event.currentTarget as HTMLDivElement | null;
    const groupId = row?.dataset.groupId ?? null;
    const memberKey = row?.dataset.memberKey ?? null;
    if (!row || !groupId || !memberKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.activateGroupMember(groupId, memberKey);
  };

  private readonly handleGroupHeaderContextMenu = (event: MouseEvent) => {
    const header = event.currentTarget as HTMLDivElement | null;
    const groupId = header?.dataset.groupId ?? null;
    if (!header || !groupId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.showContextMenu(
      { kind: "group-header", groupId },
      event.screenX,
      event.screenY,
    );
  };

  private readonly handleRowDragStart = (event: DragEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      event.preventDefault();
      return;
    }

    const groupId = row.dataset.groupId ?? null;
    const memberKey = row.dataset.memberKey ?? null;
    if (groupId && memberKey) {
      this.hideContextMenu();
      this.draggedTabKey = null;
      this.draggedGroupId = groupId;
      this.draggedMemberKey = memberKey;
      this.dragOverTabKey = null;
      this.dragOverGroupId = null;
      this.dragOverMemberKey = null;
      this.dragOverPosition = null;
      row.classList.add("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.dropEffect = "move";
        event.dataTransfer.setData("text/plain", memberKey);
      }
      return;
    }

    const tabKey = row.dataset.tabKey ?? null;
    const tracked = tabKey ? this.trackedTabsByKey.get(tabKey) : null;
    if (!tracked?.tabId) {
      event.preventDefault();
      return;
    }
    this.hideContextMenu();
    this.draggedTabKey = tabKey;
    this.draggedGroupId = null;
    this.draggedMemberKey = null;
    this.dragOverTabKey = null;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = null;
    row.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
      event.dataTransfer.setData("text/plain", tracked.key);
    }
  };

  private readonly handleRowDragOver = (event: DragEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      return;
    }

    if (this.draggedGroupId && this.draggedMemberKey) {
      const targetGroupId = row.dataset.groupId ?? null;
      const targetMemberKey = row.dataset.memberKey ?? null;
      if (!targetGroupId) {
        const targetTabKey = row.dataset.tabKey ?? null;
        if (!targetTabKey) {
          event.preventDefault();
          this.clearDropIndicator();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        this.setGroupMemberToTabDropIndicator(
          targetTabKey,
          this.getDropPosition(row, event),
        );
        return;
      }

      if (!targetMemberKey || targetMemberKey === this.draggedMemberKey) {
        event.preventDefault();
        this.clearDropIndicator();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.setGroupDropIndicator(
        targetGroupId,
        targetMemberKey,
        this.getDropPosition(row, event),
      );
      return;
    }

    if (!this.draggedTabKey) {
      return;
    }

    const tabKey = row.dataset.tabKey ?? null;
    const targetGroupId = row.dataset.groupId ?? null;
    const targetMemberKey = row.dataset.memberKey ?? null;
    if (targetGroupId && targetMemberKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.setTabToGroupDropIndicator(
        targetGroupId,
        targetMemberKey,
        this.getDropPosition(row, event),
      );
      return;
    }

    if (!tabKey || tabKey === this.draggedTabKey) {
      event.preventDefault();
      this.clearDropIndicator();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const target = this.resolveDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDropIndicator();
      return;
    }

    this.setDropIndicator(target.tabKey, target.position);
  };

  private readonly handleRowDrop = (event: DragEvent) => {
    const row = event.currentTarget as HTMLDivElement | null;
    if (!row) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (this.draggedGroupId && this.draggedMemberKey) {
      const targetGroupId = row.dataset.groupId ?? null;
      const targetMemberKey = row.dataset.memberKey ?? null;
      if (!targetGroupId) {
        this.commitGroupMemberToTabDrop(
          row.dataset.tabKey ?? null,
          this.getDropPosition(row, event),
        );
      } else if (targetMemberKey) {
        this.commitGroupMemberDrop(
          targetGroupId,
          targetMemberKey,
          this.getDropPosition(row, event),
        );
      } else {
        this.clearDragState();
      }
      return;
    }

    if (!this.draggedTabKey) {
      return;
    }

    const targetGroupId = row.dataset.groupId ?? null;
    const targetMemberKey = row.dataset.memberKey ?? null;
    if (targetGroupId && targetMemberKey) {
      this.commitTabToGroupDrop(
        targetGroupId,
        targetMemberKey,
        this.getDropPosition(row, event),
      );
      return;
    }

    const target = this.resolveDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDragState();
      return;
    }

    this.commitDrop(target.tabKey, target.position);
  };

  private readonly handleRowDragEnd = () => {
    this.clearDragState();
  };

  private readonly handleGroupHeaderDragStart = (event: DragEvent) => {
    const header = event.currentTarget as HTMLDivElement | null;
    const groupId = header?.dataset.groupId ?? null;
    if (!header || !groupId) {
      event.preventDefault();
      return;
    }
    this.hideContextMenu();
    this.draggedTabKey = null;
    this.draggedGroupId = null;
    this.draggedMemberKey = null;
    this.draggedHeaderGroupId = groupId;
    this.dragOverTabKey = null;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = null;
    header.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
      event.dataTransfer.setData("text/plain", groupId);
    }
  };

  private readonly handleGroupHeaderDragOver = (event: DragEvent) => {
    const header = event.currentTarget as HTMLDivElement | null;
    const targetGroupId = header?.dataset.groupId ?? null;
    if (this.draggedGroupId && this.draggedMemberKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.setGroupAppendDropIndicator(targetGroupId);
      return;
    }

    if (this.draggedTabKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      this.setTabToGroupAppendDropIndicator(targetGroupId);
      return;
    }

    if (!this.draggedHeaderGroupId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const target = this.resolveGroupHeaderDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDropIndicator();
      return;
    }

    this.setGroupHeaderDropIndicator(target.groupId, target.position);
  };

  private readonly handleGroupHeaderDrop = (event: DragEvent) => {
    const header = event.currentTarget as HTMLDivElement | null;
    const targetGroupId = header?.dataset.groupId ?? null;
    if (this.draggedGroupId && this.draggedMemberKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitGroupMemberDrop(targetGroupId, null, "after");
      return;
    }

    if (this.draggedTabKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitTabToGroupDrop(targetGroupId, null, "after");
      return;
    }

    if (!this.draggedHeaderGroupId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = this.resolveGroupHeaderDropTargetFromPoint(event.clientY);
    if (!target) {
      this.clearDragState();
      return;
    }

    this.commitGroupHeaderDrop(target.groupId, target.position);
  };

  private readonly handleGroupHeaderDragEnd = () => {
    this.clearDragState();
  };

  private selectTrackedTabByKey(tabKey: string | null): void {
    if (!tabKey) {
      return;
    }

    const tracked = this.trackedTabsByKey.get(tabKey);
    if (!tracked) {
      this.tracker.reconcile("missing-tab-key");
      return;
    }
    this.selectTrackedTab(tracked);
  }

  private selectTrackedTab(tab: TrackedTab): void {
    const tabId = tab.tabId;
    if (!tabId) {
      return;
    }

    if (this.commandController.select(tabId)) {
      return;
    }

    this.tracker.reconcile("failed-select");
  }

  private createGroupFromUngroupedTabs(): void {
    const ungroupedTabs = this.groupStore.getUngroupedTabs(
      this.tracker
        .getTabs()
        .map((tab) => this.normalizeTab(tab))
        .filter((tab) => this.shouldRenderTab(tab)),
    );
    if (!ungroupedTabs.length) {
      return;
    }

    this.beginCreateGroupEditorForTabs(ungroupedTabs, getString("new-group"));
  }

  private beginCreateGroupEditor(sourceTab: TrackedTab): void {
    this.beginCreateGroupEditorForTabs([sourceTab], sourceTab.title);
  }

  private beginCreateGroupEditorForTabs(
    sourceTabs: TrackedTab[],
    value: string,
  ): void {
    if (!sourceTabs.length) {
      return;
    }

    this.groupNameEditor = {
      kind: "create",
      sourceTabs,
      value,
    };
    this.prepareInlineGroupNameEditor();
  }

  private beginRenameGroupEditor(group: VirtualGroup): void {
    this.groupNameEditor = {
      kind: "rename",
      groupId: group.id,
      value: group.name,
    };
    this.prepareInlineGroupNameEditor();
  }

  private prepareInlineGroupNameEditor(): void {
    this.hideContextMenu();
    this.clearDragState();
    if (this.collapsed) {
      this.collapsed = false;
      this.applySidebarWidth();
      this.persistSidebarState();
    }
    if (this.viewMode !== "default") {
      this.viewMode = "default";
      this.persistSidebarState();
    }
    this.render(this.tracker.getSnapshot());
    this.focusInlineGroupNameEditor();
  }

  private focusInlineGroupNameEditor(): void {
    this.window.setTimeout(() => {
      const input = this.listContainer?.querySelector(
        ".tab-enhance-inline-group-name-input",
      ) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  private commitInlineGroupNameEditor(): void {
    const editor = this.groupNameEditor;
    if (!editor) {
      return;
    }

    const name = editor.value.trim() || getString("new-group");
    this.groupNameEditor = null;
    if (editor.kind === "create") {
      this.groupStore.createGroupFromTabs(editor.sourceTabs, name);
    } else {
      this.groupStore.renameGroup(editor.groupId, name);
    }
    this.render(this.tracker.getSnapshot());
  }

  private cancelInlineGroupNameEditor(): void {
    if (!this.groupNameEditor) {
      return;
    }
    this.groupNameEditor = null;
    this.render(this.tracker.getSnapshot());
  }
  private async activateGroupMember(
    groupId: string,
    memberKey: string,
  ): Promise<void> {
    await this.ensureGroupMemberOpen(groupId, memberKey, true);
  }

  private async ensureGroupMemberOpen(
    groupId: string,
    memberKey: string,
    selectIfAlreadyOpen: boolean,
  ): Promise<boolean> {
    const liveTab = this.findTrackedTabByMemberKey(memberKey);
    if (liveTab?.tabId) {
      if (selectIfAlreadyOpen) {
        this.selectTrackedTab(liveTab);
      }
      return true;
    }

    const pendingOpen = this.pendingMemberOpenPromises.get(memberKey);
    if (pendingOpen) {
      const result = await pendingOpen;
      if (result && selectIfAlreadyOpen) {
        const pendingLiveTab = this.findTrackedTabByMemberKey(memberKey, true);
        if (pendingLiveTab?.tabId) {
          this.selectTrackedTab(pendingLiveTab);
        }
      }
      return result;
    }

    const group = this.groupStore.findGroupById(groupId);
    const member =
      group?.members.find((item) => item.key === memberKey) ?? null;
    if (!member) {
      return false;
    }

    const openPromise = this.openGroupMemberAttachment(
      member,
      groupId,
      memberKey,
    );
    this.pendingMemberOpenPromises.set(memberKey, openPromise);
    try {
      const result = await openPromise;
      if (result && selectIfAlreadyOpen) {
        const reopenedTab = this.findTrackedTabByMemberKey(memberKey, true);
        if (reopenedTab?.tabId) {
          this.selectTrackedTab(reopenedTab);
        }
      }
      return result;
    } finally {
      this.pendingMemberOpenPromises.delete(memberKey);
    }
  }

  private async openGroupMemberAttachment(
    member: VirtualGroupMember,
    groupId: string,
    memberKey: string,
  ): Promise<boolean> {
    const preferredItemID = member.itemID ?? member.parentItemID;
    if (preferredItemID == null) {
      return false;
    }

    try {
      const alreadyOpenTab = this.findTrackedTabByMemberKey(memberKey, true);
      if (alreadyOpenTab?.tabId) {
        return true;
      }

      await this.wait(SIDEBAR.READER_REOPEN_SETTLE_MS);
      const openItem = await this.resolveForegroundOpenItem(preferredItemID);
      if (!openItem) {
        return false;
      }
      if (openItem.isFileAttachment?.()) {
        await this.commandController.openAttachmentTab(openItem.id, {
          openInBackground: true,
        });
      } else {
        await (Zotero as any).FileHandlers.open(openItem);
      }
      this.tracker.requestReconcile(`group-member-open:${member.key}`, 0);
      this.tracker.scheduleDelayedReconcile(
        `group-member-open:${member.key}`,
        [80, 220, 480],
      );
      return true;
    } catch (error) {
      ztoolkit.log("VerticalTabSidebar activateGroupMember failed", {
        groupId,
        memberKey,
        error,
      });
      return false;
    }
  }

  private async openGroupMembers(
    groupId: string,
    options: { closeOthers?: boolean } = {},
  ): Promise<void> {
    const group = this.groupStore.findGroupById(groupId);
    if (!group) {
      return;
    }

    if (options.closeOthers) {
      const memberKeys = new Set(group.members.map((member) => member.key));
      this.tracker
        .getTabs()
        .map((tab) => this.normalizeTab(tab))
        .filter((tab) => this.shouldRenderTab(tab))
        .forEach((tab) => {
          const tabMemberKey = this.groupStore.makeMemberKeyFromTab(tab);
          if (!memberKeys.has(tabMemberKey) && tab.tabId) {
            this.commandController.close(tab.tabId);
          }
        });
      this.tracker.scheduleDelayedReconcile(
        `group-close-others:${groupId}`,
        [80, 220],
      );
    }

    for (const member of group.members) {
      await this.ensureGroupMemberOpen(groupId, member.key, false);
      await this.wait(80);
    }

    this.tracker.reconcile(`group-open-all:${groupId}`);
    this.tracker.scheduleDelayedReconcile(
      `group-open-all:${groupId}`,
      [120, 320, 640],
    );
  }

  private closeGroupMembers(groupId: string): void {
    const group = this.groupStore.findGroupById(groupId);
    if (!group) {
      return;
    }

    const memberKeys = new Set(group.members.map((member) => member.key));
    const tabIdsToClose = Array.from(
      new Set(
        this.tracker
          .getTabs()
          .map((tab) => this.normalizeTab(tab))
          .filter((tab) => this.shouldRenderTab(tab))
          .filter((tab) =>
            memberKeys.has(this.groupStore.makeMemberKeyFromTab(tab)),
          )
          .map((tab) => tab.tabId)
          .filter((tabId): tabId is string => Boolean(tabId)),
      ),
    );

    if (!tabIdsToClose.length) {
      return;
    }

    tabIdsToClose.forEach((tabId) => {
      this.commandController.close(tabId);
    });
    this.tracker.scheduleDelayedReconcile(
      `group-close-all:${groupId}`,
      [80, 220, 480],
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.window.setTimeout(resolve, ms);
    });
  }

  private async resolveForegroundOpenItem(itemID: number): Promise<any | null> {
    const item = Zotero.Items.get(itemID);
    if (!item) {
      return null;
    }

    if (item.isFileAttachment?.()) {
      return item;
    }

    return (await item.getBestAttachment?.()) ?? item;
  }

  private async openItemsAsTrackedTabs(items: any[]): Promise<TrackedTab[]> {
    const selectedItems = Array.isArray(items) ? items : [];
    const selectedCount = selectedItems.length;
    const openedTabs: TrackedTab[] = [];
    const seenAttachmentIDs = new Set<number>();

    for (const item of selectedItems) {
      const attachment = await this.resolveOpenableAttachmentItem(item);
      const attachmentID =
        typeof attachment?.id === "number" ? attachment.id : null;
      if (attachmentID == null || seenAttachmentIDs.has(attachmentID)) {
        continue;
      }
      seenAttachmentIDs.add(attachmentID);

      try {
        const tabId = await this.commandController.openAttachmentTab(
          attachmentID,
          {
            openInBackground: selectedCount > 1,
            selectAfterOpen: selectedCount === 1,
          },
        );
        if (!tabId) {
          continue;
        }

        this.tracker.reconcile(`item-menu-open:${attachmentID}`);
        openedTabs.push(
          this.findTrackedTabByTabId(tabId) ??
            this.makeTrackedTabFromAttachment(attachment, tabId),
        );
      } catch (error) {
        ztoolkit.log("VerticalTabSidebar item menu open failed", {
          attachmentID,
          error,
        });
      }
    }

    return openedTabs;
  }

  private async resolveOpenableAttachmentItem(item: any): Promise<any | null> {
    if (!item) {
      return null;
    }

    try {
      if (item.isFileAttachment?.()) {
        return item;
      }

      const attachment = await item.getBestAttachment?.();
      return attachment?.isFileAttachment?.() ? attachment : null;
    } catch (error) {
      ztoolkit.log("VerticalTabSidebar failed to resolve item attachment", {
        itemID: item?.id,
        error,
      });
      return null;
    }
  }

  private makeTrackedTabFromAttachment(
    attachment: any,
    tabId: string,
  ): TrackedTab {
    const parentItem = attachment?.topLevelItem ?? null;
    const parentItemID =
      typeof attachment?.parentItemID === "number"
        ? attachment.parentItemID
        : typeof parentItem?.id === "number" && parentItem.id !== attachment.id
          ? parentItem.id
          : null;

    return {
      key: `tab:${tabId}`,
      tabId,
      type: "reader",
      title: this.getItemTitle(parentItem ?? attachment),
      itemID: typeof attachment?.id === "number" ? attachment.id : null,
      parentItemID,
      isOpen: true,
      isSelected: false,
      nativeIndex: this.tracker.getTabs().length,
      openedAt: Date.now(),
      iconKey: "reader",
    };
  }

  private getItemTitle(item: any): string {
    try {
      const displayTitle = item?.getDisplayTitle?.();
      if (typeof displayTitle === "string" && displayTitle.trim()) {
        return displayTitle.trim();
      }
      const fieldTitle = item?.getField?.("title");
      if (typeof fieldTitle === "string" && fieldTitle.trim()) {
        return fieldTitle.trim();
      }
      if (typeof item?.title === "string" && item.title.trim()) {
        return item.title.trim();
      }
    } catch {
      // Fall through to the stable fallback below.
    }
    return "Untitled";
  }

  private showContextMenu(
    target: ContextMenuTarget,
    screenX: number,
    screenY: number,
  ): void {
    this.menuController.showContextMenu(
      this.contextMenu,
      target,
      screenX,
      screenY,
    );
  }

  private hideContextMenu(): void {
    this.menuController.hideContextMenu(this.contextMenu);
  }

  private commitDrop(
    targetTabKey: string | null,
    position: DropPosition,
  ): void {
    const sourceTabKey = this.draggedTabKey;
    if (this.isNoOpDropTarget(targetTabKey, position, sourceTabKey)) {
      this.clearDragState();
      return;
    }
    commitTabDrop({
      sourceTabKey,
      targetTabKey,
      position,
      getTrackedTabByKey: (tabKey) =>
        (tabKey ? this.trackedTabsByKey.get(tabKey) : null) ?? null,
      clearDragState: () => this.clearDragState(),
      moveOpenTabs: (tabIds, targetIndex) =>
        this.commandController.moveOpenTabs(tabIds, targetIndex),
      reconcile: (reason) => {
        this.tracker.reconcile(reason);
      },
      scheduleDelayedReconcile: (reason, delays) => {
        this.tracker.scheduleDelayedReconcile(reason, delays);
      },
    });
  }

  private commitTabToGroupDrop(
    targetGroupId: string | null,
    targetMemberKey: string | null,
    position: DropPosition,
  ): void {
    const sourceTabKey = this.draggedTabKey;
    const sourceTab = sourceTabKey
      ? this.trackedTabsByKey.get(sourceTabKey) ?? null
      : null;
    if (
      !targetGroupId ||
      !sourceTab ||
      this.groupStore.containsTab(targetGroupId, sourceTab)
    ) {
      this.clearDragState();
      return;
    }

    if (
      targetMemberKey &&
      !this.groupStore
        .findGroupById(targetGroupId)
        ?.members.some((member) => member.key === targetMemberKey)
    ) {
      this.clearDragState();
      return;
    }

    commitTabToGroupDrop({
      sourceTabKey,
      targetGroupId,
      targetMemberKey,
      position,
      getTrackedTabByKey: (tabKey) =>
        (tabKey ? this.trackedTabsByKey.get(tabKey) : null) ?? null,
      clearDragState: () => this.clearDragState(),
      addTabToGroup: (groupId, tab, memberKey, dropPosition) =>
        this.groupStore.addTabToGroup(
          groupId,
          tab,
          memberKey,
          dropPosition,
        ),
    });
    this.render(this.tracker.getSnapshot());
  }

  private commitGroupMemberDrop(
    targetGroupId: string | null,
    targetMemberKey: string | null,
    position: DropPosition,
  ): void {
    if (
      !targetMemberKey &&
      (!targetGroupId ||
        targetGroupId === this.draggedGroupId ||
        this.groupStore
          .findGroupById(targetGroupId)
          ?.members.some((member) => member.key === this.draggedMemberKey))
    ) {
      this.clearDragState();
      return;
    }

    if (
      this.isNoOpGroupMemberDropTarget(
        targetGroupId,
        targetMemberKey,
        position,
        this.draggedGroupId,
        this.draggedMemberKey,
      )
    ) {
      this.clearDragState();
      return;
    }
    commitGroupMemberDrop({
      sourceGroupId: this.draggedGroupId,
      sourceMemberKey: this.draggedMemberKey,
      targetGroupId,
      targetMemberKey,
      position,
      clearDragState: () => this.clearDragState(),
      reorderMember: (
        groupId,
        sourceMemberKey,
        targetMemberKey,
        dropPosition,
      ) =>
        this.groupStore.reorderMember(
          groupId,
          sourceMemberKey,
          targetMemberKey,
          dropPosition,
        ),
      moveMember: (
        sourceGroupId,
        targetGroupId,
        sourceMemberKey,
        targetMemberKey,
        dropPosition,
      ) =>
        this.groupStore.moveMemberToGroup(
          sourceGroupId,
          targetGroupId,
          sourceMemberKey,
          targetMemberKey,
          dropPosition,
        ),
    });
    this.render(this.tracker.getSnapshot());
  }

  private commitGroupMemberToTabDrop(
    targetTabKey: string | null,
    position: DropPosition,
  ): void {
    if (!targetTabKey || !this.findTrackedTabByMemberKey(this.draggedMemberKey ?? "")) {
      this.clearDragState();
      return;
    }

    commitGroupMemberToTabDrop({
      sourceGroupId: this.draggedGroupId,
      sourceMemberKey: this.draggedMemberKey,
      targetTabKey,
      position,
      getTrackedTabByKey: (tabKey) =>
        (tabKey ? this.trackedTabsByKey.get(tabKey) : null) ?? null,
      getTrackedTabByMemberKey: (memberKey) =>
        memberKey ? this.findTrackedTabByMemberKey(memberKey) : null,
      clearDragState: () => this.clearDragState(),
      removeMember: (groupId, memberKey) =>
        this.groupStore.removeMember(groupId, memberKey),
      moveOpenTabs: (tabIds, targetIndex) =>
        this.commandController.moveOpenTabs(tabIds, targetIndex),
      reconcile: (reason) => {
        this.tracker.reconcile(reason);
      },
      scheduleDelayedReconcile: (reason, delays) => {
        this.tracker.scheduleDelayedReconcile(reason, delays);
      },
    });
    this.render(this.tracker.getSnapshot());
  }

  private commitGroupHeaderDrop(
    targetGroupId: string | null,
    position: DropPosition,
  ): void {
    if (
      this.isNoOpGroupHeaderDropTarget(
        targetGroupId,
        position,
        this.draggedHeaderGroupId,
      )
    ) {
      this.clearDragState();
      return;
    }
    commitGroupHeaderDrop({
      sourceGroupId: this.draggedHeaderGroupId,
      targetGroupId,
      position,
      clearDragState: () => this.clearDragState(),
      reorderGroup: (sourceGroupId, targetGroupId, dropPosition) =>
        this.groupStore.reorderGroup(
          sourceGroupId,
          targetGroupId,
          dropPosition,
        ),
    });
    this.render(this.tracker.getSnapshot());
  }

  private getDropPosition(row: HTMLDivElement, event: DragEvent): DropPosition {
    return resolveDropPosition({
      row,
      event,
      dragState: this.getDragState(),
    });
  }

  private setDropIndicator(
    tabKey: string | null,
    position: DropPosition | null,
  ): void {
    if (!tabKey || !position || tabKey === this.draggedTabKey) {
      this.clearDropIndicator();
      return;
    }

    if (this.isNoOpDropTarget(tabKey, position)) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverTabKey === tabKey &&
      this.dragOverPosition === position &&
      !this.dragOverGroupId &&
      !this.dragOverMemberKey
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = tabKey;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverPosition = position;
    this.updateDropIndicator();
  }

  private setGroupDropIndicator(
    groupId: string | null,
    memberKey: string | null,
    position: DropPosition | null,
  ): void {
    if (
      !groupId ||
      !memberKey ||
      !position ||
      memberKey === this.draggedMemberKey
    ) {
      this.clearDropIndicator();
      return;
    }

    if (this.isNoOpGroupMemberDropTarget(groupId, memberKey, position)) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverGroupId === groupId &&
      this.dragOverMemberKey === memberKey &&
      this.dragOverPosition === position
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = groupId;
    this.dragOverMemberKey = memberKey;
    this.dragOverPosition = position;
    this.updateDropIndicator();
  }

  private setTabToGroupDropIndicator(
    groupId: string | null,
    memberKey: string | null,
    position: DropPosition | null,
  ): void {
    const sourceTab = this.draggedTabKey
      ? this.trackedTabsByKey.get(this.draggedTabKey) ?? null
      : null;
    if (
      !groupId ||
      !memberKey ||
      !position ||
      !sourceTab ||
      this.groupStore.containsTab(groupId, sourceTab)
    ) {
      this.clearDropIndicator();
      return;
    }

    if (
      !this.groupStore
        .findGroupById(groupId)
        ?.members.some((member) => member.key === memberKey)
    ) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverGroupId === groupId &&
      this.dragOverMemberKey === memberKey &&
      this.dragOverPosition === position
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = groupId;
    this.dragOverMemberKey = memberKey;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = position;
    this.updateDropIndicator();
  }

  private setGroupMemberToTabDropIndicator(
    tabKey: string | null,
    position: DropPosition | null,
  ): void {
    const sourceTab = this.draggedMemberKey
      ? this.findTrackedTabByMemberKey(this.draggedMemberKey)
      : null;
    if (
      !tabKey ||
      !position ||
      !sourceTab?.tabId ||
      tabKey === sourceTab.key ||
      !this.trackedTabsByKey.get(tabKey)
    ) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverTabKey === tabKey &&
      this.dragOverPosition === position &&
      !this.dragOverGroupId &&
      !this.dragOverMemberKey
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = tabKey;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = position;
    this.updateDropIndicator();
  }

  private setGroupAppendDropIndicator(groupId: string | null): void {
    if (
      !groupId ||
      !this.draggedGroupId ||
      !this.draggedMemberKey ||
      groupId === this.draggedGroupId
    ) {
      this.clearDropIndicator();
      return;
    }

    const targetGroup = this.groupStore.findGroupById(groupId);
    if (
      !targetGroup ||
      targetGroup.members.some((member) => member.key === this.draggedMemberKey)
    ) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverGroupId === groupId &&
      !this.dragOverMemberKey &&
      this.dragOverPosition === "after"
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = groupId;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = "after";
    this.updateDropIndicator();
  }

  private setTabToGroupAppendDropIndicator(groupId: string | null): void {
    const sourceTab = this.draggedTabKey
      ? this.trackedTabsByKey.get(this.draggedTabKey) ?? null
      : null;
    if (
      !groupId ||
      !sourceTab ||
      this.groupStore.containsTab(groupId, sourceTab)
    ) {
      this.clearDropIndicator();
      return;
    }

    if (!this.groupStore.findGroupById(groupId)) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverGroupId === groupId &&
      !this.dragOverMemberKey &&
      this.dragOverPosition === "after"
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = groupId;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = "after";
    this.updateDropIndicator();
  }

  private setGroupHeaderDropIndicator(
    groupId: string | null,
    position: DropPosition | null,
  ): void {
    if (
      !groupId ||
      !position ||
      !this.draggedHeaderGroupId ||
      groupId === this.draggedHeaderGroupId
    ) {
      this.clearDropIndicator();
      return;
    }

    if (this.isNoOpGroupHeaderDropTarget(groupId, position)) {
      this.clearDropIndicator();
      return;
    }

    if (
      this.dragOverHeaderGroupId === groupId &&
      this.dragOverPosition === position
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = groupId;
    this.dragOverPosition = position;
    this.updateDropIndicator();
  }

  private clearDropIndicator(): void {
    if (
      !this.dragOverTabKey &&
      !this.dragOverGroupId &&
      !this.dragOverMemberKey &&
      !this.dragOverHeaderGroupId &&
      !this.dragOverPosition
    ) {
      this.updateDropIndicator();
      return;
    }

    this.dragOverTabKey = null;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = null;
    this.updateDropIndicator();
  }

  private clearDragState(): void {
    this.draggedTabKey = null;
    this.draggedGroupId = null;
    this.draggedMemberKey = null;
    this.draggedHeaderGroupId = null;
    this.dragOverTabKey = null;
    this.dragOverGroupId = null;
    this.dragOverMemberKey = null;
    this.dragOverHeaderGroupId = null;
    this.dragOverPosition = null;
    this.updateDropIndicator();
  }

  private updateDropIndicator(): void {
    updateDropIndicator(this.listContainer, this.getDragState());
  }

  private resolveDropTargetFromPoint(
    clientY: number,
  ): { tabKey: string | null; position: DropPosition } | null {
    return resolveDropTargetFromPoint(this.listContainer, clientY);
  }

  private getSortableRowFromEventTarget(
    target: EventTarget | null,
  ): HTMLDivElement | null {
    return getSortableRowFromEventTarget(this.window, target);
  }

  private getGroupIdFromEventTarget(target: EventTarget | null): string | null {
    const elementCtor = this.window.Element;
    if (!elementCtor || !target || !(target instanceof elementCtor)) {
      return null;
    }
    return (
      (target as Element).closest(".tab-enhance-vertical-group[data-group-id]")
        ?.getAttribute("data-group-id") ?? null
    );
  }

  private resolveGroupHeaderDropTargetFromPoint(
    clientY: number,
  ): { groupId: string | null; position: DropPosition } | null {
    return resolveGroupHeaderDropTargetFromPoint(this.listContainer, clientY);
  }

  private getSortableGroupHeaderFromEventTarget(
    target: EventTarget | null,
  ): HTMLDivElement | null {
    return getSortableGroupHeaderFromEventTarget(this.window, target);
  }

  private getBadgeText(iconKey: string): string {
    switch (iconKey) {
      case "reader":
        return "P";
      case "note":
        return "N";
      case "web":
        return "W";
      default:
        return iconKey.slice(0, 1).toUpperCase() || "?";
    }
  }

  private getDisplayTitle(
    input: Pick<
      TrackedTab | VirtualGroupMember,
      "title" | "itemID" | "parentItemID"
    >,
  ): string {
    if (this.isMetadataDeferred()) {
      return input.title?.trim() || "Untitled";
    }

    if (this.displayTitleMode === "shortTitle") {
      const item = this.getDisplayItem(input);
      const shortTitle = this.getItemField(item, ["shortTitle"]);
      if (shortTitle) {
        return shortTitle;
      }
    }
    return input.title?.trim() || "Untitled";
  }

  private getDisplaySubtitle(
    input: Pick<
      TrackedTab | VirtualGroupMember,
      "type" | "itemID" | "parentItemID" | "isOpen"
    >,
  ): string {
    if (this.isMetadataDeferred()) {
      return this.getLegacyMetaText(input);
    }

    switch (this.displaySubtitleMode) {
      case "none":
        return "";
      case "typeAndItem":
        return this.getLegacyMetaText(input);
      case "creatorYear": {
        const item = this.getDisplayItem(input);
        return (
          this.getCreatorYearText(item) ||
          this.getSourceText(item) ||
          this.getLegacyMetaText(input)
        );
      }
      case "source":
      default: {
        const item = this.getDisplayItem(input);
        return (
          this.getSourceText(item) ||
          this.getCreatorYearText(item) ||
          this.getLegacyMetaText(input)
        );
      }
    }
  }

  private getMetaText(tab: TrackedTab): string {
    return this.getLegacyMetaText(tab);
  }

  private getVirtualMemberMetaText(
    member: Pick<
      VirtualGroupMember,
      "type" | "itemID" | "parentItemID" | "isOpen"
    >,
  ): string {
    return this.getLegacyMetaText(member);
  }

  private getLegacyMetaText(
    input: Pick<
      TrackedTab | VirtualGroupMember,
      "type" | "itemID" | "parentItemID" | "isOpen"
    >,
  ): string {
    const parts = [
      "isOpen" in input && input.isOpen === false
        ? `${input.type} · virtual`
        : input.type,
    ];
    if (input.parentItemID != null && input.parentItemID !== input.itemID) {
      parts.push(`item ${input.parentItemID}`);
    } else if (input.itemID != null) {
      parts.push(`item ${input.itemID}`);
    }
    return parts.join(" · ");
  }

  private getDisplayItem(
    input: Pick<TrackedTab | VirtualGroupMember, "itemID" | "parentItemID">,
  ): any | null {
    const ids = [input.parentItemID, input.itemID].filter(
      (value, index, array): value is number =>
        typeof value === "number" && array.indexOf(value) === index,
    );
    const cacheKey = ids.length ? ids.join("|") : "none";
    if (this.displayItemIDCache.has(cacheKey)) {
      const cachedItemID = this.displayItemIDCache.get(cacheKey);
      return typeof cachedItemID === "number"
        ? (Zotero.Items.get(cachedItemID) ?? null)
        : null;
    }
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (item) {
        this.displayItemIDCache.set(cacheKey, id);
        return item;
      }
    }
    this.displayItemIDCache.set(cacheKey, null);
    return null;
  }

  private getItemField(item: any | null, fields: string[]): string {
    if (!item) {
      return "";
    }
    for (const field of fields) {
      const cacheKey =
        typeof item.id === "number"
          ? `${item.id}:${field}`
          : `unknown:${field}`;
      if (this.itemFieldCache.has(cacheKey)) {
        const cachedValue = this.itemFieldCache.get(cacheKey);
        if (cachedValue) {
          return cachedValue;
        }
        continue;
      }
      try {
        const value = item.getField(field);
        if (typeof value === "string" && value.trim()) {
          const normalizedValue = value.trim();
          this.itemFieldCache.set(cacheKey, normalizedValue);
          return normalizedValue;
        }
      } catch {
        this.itemFieldCache.set(cacheKey, "");
        continue;
      }
      this.itemFieldCache.set(cacheKey, "");
    }
    return "";
  }

  private getSourceText(item: any | null): string {
    return this.getItemField(item, [
      "publicationTitle",
      "proceedingsTitle",
      "bookTitle",
      "websiteTitle",
      "forumTitle",
      "blogTitle",
      "seriesTitle",
    ]);
  }

  private getCreatorYearText(item: any | null): string {
    const creator = this.getItemField(item, ["firstCreator"]);
    const rawYear = this.getItemField(item, ["year", "date"]);
    const yearMatch = rawYear.match(/(19|20)\d{2}/);
    const year = yearMatch?.[0] ?? "";
    if (creator && year) {
      return `${creator} · ${year}`;
    }
    return creator || year;
  }

  private clearDisplayMetadataCache(): void {
    this.viewRenderer.clearDisplayMetadataCache();
  }

  private refreshDisplayModeCache(): void {
    this.viewRenderer.refreshDisplayModeCache();
  }

  private applyDisplayStylePrefs(): void {
    if (!this.sidebar) {
      return;
    }
    const { rowHeight, fontSize } = getVerticalTabStylePrefs();
    this.sidebar.style.setProperty("--te-tab-row-height", `${rowHeight}px`);
    this.sidebar.style.setProperty("--te-tab-font-size", `${fontSize}px`);
  }

  private findTrackedTabByMemberKey(
    memberKey: string,
    forceReconcile = false,
  ): TrackedTab | null {
    const liveTab = this.trackedTabsByMemberKey.get(memberKey) ?? null;
    if (liveTab || !forceReconcile) {
      return liveTab;
    }

    this.tracker.reconcile(`member-lookup:${memberKey}`);
    return this.trackedTabsByMemberKey.get(memberKey) ?? null;
  }

  private findTrackedTabByTabId(tabId: string | null): TrackedTab | null {
    if (!tabId) {
      return null;
    }

    return (
      this.tracker
        .getTabs()
        .map((tab) => this.normalizeTab(tab))
        .find((tab) => tab.tabId === tabId && this.shouldRenderTab(tab)) ?? null
    );
  }
}
