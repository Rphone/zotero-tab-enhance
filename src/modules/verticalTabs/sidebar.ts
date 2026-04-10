import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { getGroupColorPalette, getJSONPref, getPref, setJSONPref } from "../../utils/prefs";
import TabTrackerService from "./tabTracker";
import TabCommandController, { TabCommandItem } from "./tabCommands";
import TabGroupStore from "./groupStore";
import { setCollapsibleMeasuredHeight, syncCollapsibleState } from "./collapsible";
import {
  LIBRARY_TAB_ID,
  SidebarState,
  TabTrackerSnapshot,
  TrackedTab,
  VirtualGroup,
  VirtualGroupMember,
} from "./types";

// UI Constants
const SIDEBAR = {
  DEFAULT_EXPANDED_WIDTH: 260,
  COLLAPSED_WIDTH: 44,
  MIN_WIDTH: 160,
  ROW_HEIGHT: 72,
  ANIMATION_DURATION_MS: 250,
  SEARCH_DEBOUNCE_MS: 200,
  DROP_HYSTERESIS: 8,
} as const;

const PREF_KEYS = {
  SIDEBAR_STATE: "verticalTabs.sidebarState",
  GROUPS_STATE: "verticalTabs.groups",
} as const;

type DropPosition = "before" | "after";
type SidebarViewMode = "default" | "recent" | "type";

type ContextMenuTarget =
  | { kind: "tab"; tabKey: string }
  | { kind: "group-header"; groupId: string }
  | { kind: "group-member"; groupId: string; memberKey: string };

type RenderableGroup = {
  group: VirtualGroup;
  members: VirtualGroupMember[];
};

type AggregateSection = {
  id: string;
  title: string;
  tabs: TrackedTab[];
};

export default class VerticalTabSidebar {
  private readonly window: _ZoteroTypes.MainWindow;
  private readonly document: Document;
  private readonly tracker: TabTrackerService;
  private readonly commandController: TabCommandController;
  private readonly groupStore: TabGroupStore;
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
  private groupNamePanel?: XULPopupElement;
  private groupNameInput?: HTMLInputElement;
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
  private lastContextMenuPoint = { x: 0, y: 0 };
  private pendingGroupNameSubmit?: ((name: string) => void) | null;
  private groupNamePanelConfirmed = false;
  private readonly displayItemCache = new Map<string, any | null>();
  private readonly itemFieldCache = new Map<string, string>();
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

    if (!this.draggedTabKey || this.draggedMemberKey) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
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

    if (!this.draggedTabKey || this.draggedMemberKey) {
      return;
    }

    event.preventDefault();
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
    this.initialized = true;
    this.unsubscribeGroupStore = this.groupStore.subscribe(() => {
      if (this.initialized) {
        this.persistGroupsState();
        this.render(this.tracker.getSnapshot());
      }
    });
    this.unsubscribeTracker = this.tracker.subscribe((snapshot) => {
      const groupSyncChanged = this.groupStore.syncTrackedTabs(
        snapshot.tabs.map((tab) => this.normalizeTab(tab)),
      );
      if (!groupSyncChanged) {
        this.render(snapshot);
      }
    });
    this.window.addEventListener("mouseup", this.handleResizeEnd);
    this.window.addEventListener("dragend", this.handleWindowDragEnd, true);
    ztoolkit.log("VerticalTabSidebar initialized");
  }

  public refreshDisplayPrefs(): void {
    if (!this.initialized) {
      return;
    }
    this.clearDisplayMetadataCache();
    this.render(this.tracker.getSnapshot());
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
    this.pendingGroupToggleTimers.forEach((timerId) => {
      this.window.clearTimeout(timerId);
    });
    this.pendingGroupToggleTimers.clear();
    this.pendingMemberOpenPromises.clear();
    this.window.removeEventListener("mouseup", this.handleResizeEnd);
    this.window.removeEventListener("dragend", this.handleWindowDragEnd, true);

    this.sidebar?.remove();
    this.splitter?.remove();
    this.contextMenu?.remove();
    this.groupNamePanel?.remove();
    this.stylesheet?.remove();
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
    this.groupNamePanel = undefined;
    this.groupNameInput = undefined;
    this.stylesheet = undefined;
    this.trackedTabsByKey.clear();
    this.trackedTabsByMemberKey.clear();
    this.clearDisplayMetadataCache();
    this.groupStore.destroy();
    this.clearDragState();
    this.initialized = false;
    ztoolkit.log("VerticalTabSidebar destroyed");
  }

  private mountLayout(): boolean {
    const deck = this.window.Zotero_Tabs.deck as unknown as XULElement | null;
    const deckParent = deck?.parentNode;
    if (!deck || !deckParent) {
      return false;
    }

    this.stylesheet = this.ensureStylesheet();

    const sidebar = ztoolkit.UI.createElement(this.document, "vbox", {
      classList: ["tab-enhance-vertical-tabs-sidebar"],
      attributes: {
        id: `${config.addonRef}-vertical-tabs-sidebar`,
      },
    }) as XULElement;

    const header = ztoolkit.UI.createElement(this.document, "hbox", {
      classList: ["tab-enhance-vertical-tabs-header"],
    }) as XULElement;

    const toggleButton = ztoolkit.UI.createElement(
      this.document,
      "toolbarbutton",
      {
        classList: ["tab-enhance-vertical-tabs-toggle"],
        attributes: {
          label: "<",
          tooltiptext: "Toggle vertical tabs sidebar",
        },
        listeners: [
          {
            type: "command",
            listener: () => this.toggleCollapsed(),
          },
        ],
      },
    ) as XULElement;

    const headerText = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-title"],
      properties: {
        textContent: "Tabs",
      },
    }) as HTMLDivElement;

    const countBadge = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-count"],
      properties: {
        textContent: "0",
      },
    }) as HTMLDivElement;

    const createGroupButton = ztoolkit.UI.createElement(
      this.document,
      "button",
      {
        namespace: "html",
        classList: ["tab-enhance-vertical-tabs-create-group"],
        properties: {
          textContent: "+",
          title: getString("create-group-from-selection"),
        },
        listeners: [
          {
            type: "click",
            listener: (event: Event) => {
              event.preventDefault();
              event.stopPropagation();
              this.createGroupFromSelectedTab();
            },
          },
        ],
      },
    ) as HTMLButtonElement;

    const searchInput = ztoolkit.UI.createElement(this.document, "input", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-search"],
      attributes: {
        type: "search",
        placeholder: getString("search-tabs"),
      },
      listeners: [
        {
          type: "input",
          listener: (event: Event) => {
            const target = event.currentTarget as HTMLInputElement | null;
            this.searchQuery = target?.value.trim().toLocaleLowerCase() ?? "";
            this.persistSidebarState();
            this.render(this.tracker.getSnapshot());
          },
        },
      ],
    }) as HTMLInputElement;

    const viewSwitcher = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-view-switcher"],
    }) as HTMLDivElement;

    (
      [
        ["default", getString("view-default")],
        ["recent", getString("view-recent")],
        ["type", getString("view-type")],
      ] as const
    ).forEach(([mode, label]) => {
      const button = ztoolkit.UI.createElement(this.document, "button", {
        namespace: "html",
        classList: ["tab-enhance-vertical-tabs-view-button"],
        properties: {
          textContent: label,
          title: label,
        },
        attributes: {
          type: "button",
          "data-view-mode": mode,
        },
        listeners: [
          {
            type: "click",
            listener: (event: Event) => {
              event.preventDefault();
              event.stopPropagation();
              this.setViewMode(mode);
            },
          },
        ],
      }) as HTMLButtonElement;
      viewSwitcher.appendChild(button);
    });

    const listContainer = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-list"],
      attributes: {
        role: "listbox",
      },
      listeners: [
        {
          type: "dragover",
          listener: this.handleListDragOver,
        },
        {
          type: "drop",
          listener: this.handleListDrop,
        },
      ],
    }) as HTMLDivElement;

    const contextMenu = ztoolkit.UI.createElement(this.document, "menupopup", {
      classList: ["tab-enhance-vertical-tabs-context-menu"],
      attributes: {
        id: `${config.addonRef}-vertical-tabs-context-menu`,
      },
    }) as unknown as XULPopupElement;

    const groupNamePanel = ztoolkit.createXULElement(this.document, "panel") as unknown as XULPopupElement;
    groupNamePanel.setAttribute("id", `${config.addonRef}-group-name-panel`);
    groupNamePanel.setAttribute("class", "tab-enhance-group-name-popup");
    groupNamePanel.setAttribute("type", "arrow");
    groupNamePanel.setAttribute("flip", "both");
    groupNamePanel.setAttribute("consumeoutsideclicks", "true");
    groupNamePanel.setAttribute("noautofocus", "false");
    const groupNamePanelBody = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-group-name-panel"],
    }) as HTMLDivElement;
    const groupNameInput = ztoolkit.UI.createElement(this.document, "input", {
      namespace: "html",
      classList: ["tab-enhance-group-name-input"],
      attributes: {
        type: "text",
        placeholder: getString("group-name-prompt"),
      },
      listeners: [
        {
          type: "keydown",
          listener: (event: Event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (keyboardEvent.key === "Enter") {
              keyboardEvent.preventDefault();
              keyboardEvent.stopPropagation();
              this.confirmGroupNamePanel();
              return;
            }
            if (keyboardEvent.key === "Escape") {
              keyboardEvent.preventDefault();
              keyboardEvent.stopPropagation();
              this.cancelGroupNamePanel();
            }
          },
        },
      ],
    }) as HTMLInputElement;
    groupNamePanel.addEventListener("popupshown", () => {
      this.groupNameInput?.focus();
      this.groupNameInput?.select();
    });
    groupNamePanel.addEventListener("popuphidden", () => {
      if (!this.groupNamePanelConfirmed) {
        this.pendingGroupNameSubmit = null;
      }
      this.groupNamePanelConfirmed = false;
    });
    groupNamePanelBody.appendChild(groupNameInput);
    groupNamePanel.appendChild(groupNamePanelBody);

    header.appendChild(toggleButton);
    header.appendChild(headerText);
    header.appendChild(countBadge);
    header.appendChild(createGroupButton);
    sidebar.appendChild(header);
    sidebar.appendChild(searchInput);
    sidebar.appendChild(viewSwitcher);
    sidebar.appendChild(listContainer);

    const popupHost =
      this.document.getElementById("mainPopupSet") ??
      this.document.documentElement;
    popupHost?.appendChild(contextMenu);
    popupHost?.appendChild(groupNamePanel);

    const splitter = ztoolkit.UI.createElement(this.document, "splitter", {
      classList: ["tab-enhance-vertical-tabs-splitter"],
      attributes: {
        id: `${config.addonRef}-vertical-tabs-splitter`,
      },
      listeners: [
        {
          type: "mousedown",
          listener: () => {
            this.isResizing = true;
          },
        },
      ],
    }) as XULElement;

    deckParent.insertBefore(splitter, deck);
    deckParent.insertBefore(sidebar, splitter);

    this.sidebar = sidebar;
    this.splitter = splitter;
    this.toggleButton = toggleButton;
    this.createGroupButton = createGroupButton;
    this.viewSwitcher = viewSwitcher;
    this.headerTitle = headerText;
    this.countBadge = countBadge;
    this.searchInput = searchInput;
    this.listContainer = listContainer;
    this.contextMenu = contextMenu;
    this.groupNamePanel = groupNamePanel;
    this.groupNameInput = groupNameInput;
    this.applySidebarWidth();
    return true;
  }

  private ensureStylesheet(): HTMLElement {
    const stylesheetId = `${config.addonRef}-vertical-tabs-style`;
    const existing = this.document.getElementById(
      stylesheetId,
    ) as HTMLElement | null;
    if (existing) {
      return existing;
    }

    const link = ztoolkit.UI.createElement(this.document, "link", {
      namespace: "html",
      attributes: {
        id: stylesheetId,
        rel: "stylesheet",
        type: "text/css",
        href: `chrome://${config.addonRef}/content/zoteroPane.css`,
      },
    }) as HTMLElement;
    this.document.documentElement?.appendChild(link);
    return link;
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
    const sidebarState = getJSONPref<Partial<SidebarState>>(
      PREF_KEYS.SIDEBAR_STATE,
      {},
    );

    if (typeof sidebarState.collapsed === "boolean") {
      this.collapsed = sidebarState.collapsed;
    }

    if (
      typeof sidebarState.width === "number" &&
      Number.isFinite(sidebarState.width) &&
      sidebarState.width >= SIDEBAR.MIN_WIDTH
    ) {
      this.expandedWidth = Math.round(sidebarState.width);
    }

    if (typeof sidebarState.searchQuery === "string") {
      this.searchQuery = sidebarState.searchQuery;
      if (this.searchInput) {
        this.searchInput.value = sidebarState.searchQuery;
      }
    }

    if (this.isSidebarViewMode(sidebarState.viewMode)) {
      this.viewMode = sidebarState.viewMode;
    }

    const restoredGroups = this.sanitizeGroups(
      getJSONPref<VirtualGroup[]>(PREF_KEYS.GROUPS_STATE, []),
    );
    if (restoredGroups.length > 0) {
      this.groupStore.setGroups(restoredGroups);
    }

    this.applySidebarWidth();
    this.updateViewSwitcher();
  }

  private persistSidebarState(): void {
    const state: SidebarState = {
      collapsed: this.collapsed,
      width: this.expandedWidth,
      searchQuery: this.searchQuery,
      selectedKeys: [],
      viewMode: this.viewMode,
    };
    setJSONPref(PREF_KEYS.SIDEBAR_STATE, state);
  }

  private persistGroupsState(): void {
    setJSONPref(PREF_KEYS.GROUPS_STATE, this.groupStore.getGroups());
  }

  private sanitizeGroups(groups: VirtualGroup[]): VirtualGroup[] {
    if (!Array.isArray(groups)) {
      return [];
    }

    const seenGroupIds = new Set<string>();
    return groups.flatMap((group, groupIndex) => {
      if (!group || typeof group !== "object") {
        return [];
      }

      const groupId =
        typeof group.id === "string" && group.id.trim()
          ? group.id
          : `restored-group-${groupIndex}`;
      if (seenGroupIds.has(groupId)) {
        return [];
      }
      seenGroupIds.add(groupId);

      const members = Array.isArray(group.members) ? group.members : [];
      const normalizedMembers = members.flatMap((member, memberIndex) => {
        if (!member || typeof member !== "object") {
          return [];
        }

        const itemID = typeof member.itemID === "number" ? member.itemID : null;
        const parentItemID =
          typeof member.parentItemID === "number" ? member.parentItemID : null;
        const hasResolvableItem =
          (itemID != null && Boolean(Zotero.Items.get(itemID))) ||
          (parentItemID != null && Boolean(Zotero.Items.get(parentItemID)));

        if ((itemID != null || parentItemID != null) && !hasResolvableItem) {
          return [];
        }

        const memberKey =
          typeof member.key === "string" && member.key.trim()
            ? member.key
            : null;
        if (!memberKey) {
          return [];
        }

        return [
          {
            id:
              typeof member.id === "string" && member.id.trim()
                ? member.id
                : `restored-member-${groupIndex}-${memberIndex}`,
            key: memberKey,
            sourceTabKey:
              typeof member.sourceTabKey === "string" &&
              member.sourceTabKey.trim()
                ? member.sourceTabKey
                : null,
            tabId:
              typeof member.tabId === "string" && member.tabId.trim()
                ? member.tabId
                : null,
            type:
              typeof member.type === "string" && member.type.trim()
                ? member.type
                : "reader",
            title:
              typeof member.title === "string" && member.title.trim()
                ? member.title
                : memberKey,
            itemID,
            parentItemID,
            isOpen: Boolean(member.isOpen),
            openedAt:
              typeof member.openedAt === "number" &&
              Number.isFinite(member.openedAt)
                ? member.openedAt
                : null,
            iconKey:
              typeof member.iconKey === "string" && member.iconKey.trim()
                ? member.iconKey
                : "reader",
          },
        ];
      });

      if (!normalizedMembers.length) {
        return [];
      }

      return [
        {
          id: groupId,
          name:
            typeof group.name === "string" && group.name.trim()
              ? group.name.trim()
              : getString("new-group"),
          color:
            typeof group.color === "string" && group.color.trim()
              ? group.color
              : getGroupColorPalette()[groupIndex % getGroupColorPalette().length],
          collapsed: Boolean(group.collapsed),
          sortMode:
            group.sortMode === "recent" ||
            group.sortMode === "type" ||
            group.sortMode === "manual"
              ? group.sortMode
              : "manual",
          members: normalizedMembers,
        },
      ];
    });
  }

  private isSidebarViewMode(value: unknown): value is SidebarViewMode {
    return value === "default" || value === "recent" || value === "type";
  }

  private render(snapshot: TabTrackerSnapshot): void {
    if (!this.listContainer || !this.countBadge || !this.headerTitle) {
      return;
    }

    const openTabs = snapshot.tabs
      .map((tab) => this.normalizeTab(tab))
      .filter((tab) => this.shouldRenderTab(tab));
    const renderableGroups = this.getRenderableGroups(openTabs);
    const visibleUngroupedTabs = this.groupStore
      .getUngroupedTabs(openTabs)
      .filter((tab) => this.matchesSearch(tab));
    const aggregateSections = this.getAggregateSections(openTabs);
    const listContainer = this.listContainer;

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
    this.hideContextMenu();
    this.updateViewSwitcher();
    this.headerTitle.textContent = this.getViewTitle();
    this.countBadge.textContent = String(openTabs.length);
    listContainer.textContent = "";

    if (
      this.draggedTabKey &&
      (this.viewMode !== "default" ||
        !visibleUngroupedTabs.some((tab) => tab.key === this.draggedTabKey))
    ) {
      this.clearDragState();
    }

    if (
      this.draggedGroupId &&
      this.draggedMemberKey &&
      !renderableGroups.some(
        (group) =>
          group.group.id === this.draggedGroupId &&
          group.members.some((member) => member.key === this.draggedMemberKey),
      )
    ) {
      this.clearDragState();
    }

    if (
      this.draggedHeaderGroupId &&
      !renderableGroups.some(
        (group) => group.group.id === this.draggedHeaderGroupId,
      )
    ) {
      this.clearDragState();
    }

    const hasDefaultContent =
      renderableGroups.length > 0 || visibleUngroupedTabs.length > 0;
    const hasAggregateContent = aggregateSections.some(
      (section) => section.tabs.length > 0,
    );

    if (
      (this.viewMode === "default" && !hasDefaultContent) ||
      (this.viewMode !== "default" && !hasAggregateContent)
    ) {
      const emptyState = ztoolkit.UI.createElement(this.document, "div", {
        namespace: "html",
        classList: ["tab-enhance-vertical-tabs-empty"],
        properties: {
          textContent: this.searchQuery
            ? getString("no-matching-tabs")
            : this.collapsed
              ? "0"
              : "No tabs open",
        },
      }) as HTMLDivElement;
      listContainer.appendChild(emptyState);
      return;
    }

    if (this.viewMode === "default") {
      renderableGroups.forEach((renderableGroup) => {
        if (
          renderableGroup.group.id === this.dragOverHeaderGroupId &&
          this.dragOverPosition === "before"
        ) {
          listContainer.appendChild(this.renderDropPlaceholder());
        }

        listContainer.appendChild(
          this.renderGroupSection(renderableGroup, snapshot.selectedTabKey),
        );

        if (
          renderableGroup.group.id === this.dragOverHeaderGroupId &&
          this.dragOverPosition === "after"
        ) {
          listContainer.appendChild(this.renderDropPlaceholder());
        }
      });

      visibleUngroupedTabs.forEach((tab) => {
        if (
          tab.key === this.dragOverTabKey &&
          this.dragOverPosition === "before"
        ) {
          listContainer.appendChild(this.renderDropPlaceholder());
        }

        listContainer.appendChild(
          this.renderTabRow(tab, snapshot.selectedTabKey, {
            sortable: true,
            grouped: false,
          }),
        );

        if (
          tab.key === this.dragOverTabKey &&
          this.dragOverPosition === "after"
        ) {
          listContainer.appendChild(this.renderDropPlaceholder());
        }
      });
      return;
    }

    aggregateSections.forEach((section) => {
      if (!section.tabs.length) {
        return;
      }
      listContainer.appendChild(
        this.renderAggregateSection(section, snapshot.selectedTabKey),
      );
    });
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

    const header = ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-header"],
      properties: {
        title: renderable.group.name,
        draggable: true,
      },
      attributes: {
        role: "button",
        tabindex: "0",
      },
      listeners: [
        {
          type: "click",
          listener: (event: Event) => {
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
    header.dataset.sortable = "true";
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

    const title = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-vertical-group-title"],
      properties: {
        textContent: renderable.group.name,
      },
    }) as HTMLSpanElement;

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
        this.renderGroupMemberRow(
          member,
          renderable.group.id,
          selectedTabKey,
        ),
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
    return this.groupStore
      .getUngroupedTabs(
        snapshot.tabs
          .map((tab) => this.normalizeTab(tab))
          .filter((tab) => this.shouldRenderTab(tab)),
      )
      .filter((tab) => this.matchesSearch(tab));
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

  private isNoOpDropTarget(
    targetTabKey: string | null,
    position: DropPosition | null,
    sourceTabKey = this.draggedTabKey,
  ): boolean {
    if (!sourceTabKey || !targetTabKey || !position) {
      return false;
    }

    const visibleKeys = this.getVisibleSortableTabs(
      this.tracker.getSnapshot(),
    ).map((tab) => tab.key);
    const sourceIndex = visibleKeys.indexOf(sourceTabKey);
    const targetIndex = visibleKeys.indexOf(targetTabKey);
    if (sourceIndex < 0 || targetIndex < 0) {
      return false;
    }

    return (
      (position === "after" && targetIndex === sourceIndex - 1) ||
      (position === "before" && targetIndex === sourceIndex + 1)
    );
  }

  private isNoOpGroupMemberDropTarget(
    targetGroupId: string | null,
    targetMemberKey: string | null,
    position: DropPosition | null,
    sourceGroupId = this.draggedGroupId,
    sourceMemberKey = this.draggedMemberKey,
  ): boolean {
    if (
      !sourceGroupId ||
      !sourceMemberKey ||
      !targetGroupId ||
      !targetMemberKey ||
      !position ||
      sourceGroupId !== targetGroupId
    ) {
      return false;
    }

    const group = this.groupStore.findGroupById(targetGroupId);
    const visibleKeys = group?.members.map((member) => member.key) ?? [];
    const sourceIndex = visibleKeys.indexOf(sourceMemberKey);
    const targetIndex = visibleKeys.indexOf(targetMemberKey);
    if (sourceIndex < 0 || targetIndex < 0) {
      return false;
    }

    return (
      (position === "after" && targetIndex === sourceIndex - 1) ||
      (position === "before" && targetIndex === sourceIndex + 1)
    );
  }

  private isNoOpGroupHeaderDropTarget(
    targetGroupId: string | null,
    position: DropPosition | null,
    sourceGroupId = this.draggedHeaderGroupId,
  ): boolean {
    if (!sourceGroupId || !targetGroupId || !position) {
      return false;
    }

    const visibleGroupIds = this.groupStore.getGroups().map((group) => group.id);
    const sourceIndex = visibleGroupIds.indexOf(sourceGroupId);
    const targetIndex = visibleGroupIds.indexOf(targetGroupId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return false;
    }

    return (
      (position === "after" && targetIndex === sourceIndex - 1) ||
      (position === "before" && targetIndex === sourceIndex + 1)
    );
  }

  private normalizeTab(tab: TrackedTab): TrackedTab {
    if (tab.key && tab.key.trim()) {
      return tab;
    }

    const fallbackKey = tab.tabId
      ? `tab:${tab.tabId}`
      : `fallback:${tab.nativeIndex}:${tab.title}`;

    return {
      ...tab,
      key: fallbackKey,
    };
  }

  private shouldRenderTab(tab: TrackedTab): boolean {
    return !(
      tab.tabId === LIBRARY_TAB_ID ||
      tab.type === "library" ||
      tab.type === "zotero-pane"
    );
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
    row.appendChild(
      this.renderRowContent(
        this.getDisplayTitle(tab),
        this.getDisplaySubtitle(tab),
      ),
    );

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
    row.appendChild(
      this.renderRowContent(
        this.getDisplayTitle(member),
        this.getDisplaySubtitle(member),
      ),
    );

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
      if (
        !targetGroupId ||
        !targetMemberKey ||
        targetGroupId !== this.draggedGroupId ||
        targetMemberKey === this.draggedMemberKey
      ) {
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
    if (!tabKey || tabKey === this.draggedTabKey || row.dataset.groupId) {
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
      if (!targetGroupId || !targetMemberKey) {
        this.clearDragState();
        return;
      }
      this.commitGroupMemberDrop(
        targetGroupId,
        targetMemberKey,
        this.getDropPosition(row, event),
      );
      return;
    }

    if (!this.draggedTabKey) {
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

    try {
      this.commandController.select(tabId);
      return;
    } catch (error) {
      ztoolkit.log("VerticalTabSidebar select failed", tabId, error);
    }

    this.tracker.reconcile("failed-select");
  }

  private createGroupFromSelectedTab(): void {
    const selectedTab = this.tracker.getSelectedTab();
    if (!selectedTab) {
      return;
    }

    const name = this.promptForGroupName(selectedTab.title);
    if (name === null) {
      return;
    }

    this.groupStore.createGroupFromTab(this.normalizeTab(selectedTab), name);
  }


  private openGroupNamePanel(
    defaultValue: string,
    onSubmit: (name: string) => void,
    screenX = this.lastContextMenuPoint.x,
    screenY = this.lastContextMenuPoint.y,
  ): void {
    if (!this.groupNamePanel || !this.groupNameInput) {
      const fallbackValue = this.promptForGroupName(defaultValue);
      if (fallbackValue !== null) {
        onSubmit(fallbackValue);
      }
      return;
    }

    this.groupNamePanelConfirmed = false;
    this.pendingGroupNameSubmit = onSubmit;
    this.groupNameInput.value = defaultValue;
    this.groupNamePanel.openPopupAtScreen(screenX + 8, screenY + 8, true);
  }

  private confirmGroupNamePanel(): void {
    const submit = this.pendingGroupNameSubmit;
    const value = this.groupNameInput?.value.trim() || getString("new-group");
    this.pendingGroupNameSubmit = null;
    this.groupNamePanelConfirmed = true;
    this.groupNamePanel?.hidePopup();
    if (submit) {
      submit(value);
    }
  }

  private cancelGroupNamePanel(): void {
    this.pendingGroupNameSubmit = null;
    this.groupNamePanelConfirmed = false;
    this.groupNamePanel?.hidePopup();
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

    const openPromise = this.openGroupMemberAttachment(member, groupId, memberKey);
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
      let item = Zotero.Items.get(preferredItemID);
      if (!item) {
        return false;
      }

      if (!item.isFileAttachment?.()) {
        const bestAttachment = await item.getBestAttachment?.();
        if (bestAttachment) {
          item = bestAttachment;
        }
      }

      const alreadyOpenTab = this.findTrackedTabByMemberKey(memberKey, true);
      if (alreadyOpenTab?.tabId) {
        return true;
      }

      await (Zotero as any).FileHandlers.open(item);
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

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.window.setTimeout(resolve, ms);
    });
  }

  private showContextMenu(
    target: ContextMenuTarget,
    screenX: number,
    screenY: number,
  ): void {
    if (!this.contextMenu) {
      return;
    }
    this.lastContextMenuPoint = { x: screenX, y: screenY };
    this.hideContextMenu();

    switch (target.kind) {
      case "tab":
        this.populateTabContextMenu(target.tabKey);
        break;
      case "group-header":
        this.populateGroupHeaderContextMenu(target.groupId);
        break;
      case "group-member":
        this.populateGroupMemberContextMenu(target.groupId, target.memberKey);
        break;
    }

    if (!this.contextMenu.firstChild) {
      return;
    }

    this.contextMenu.openPopupAtScreen(screenX, screenY, true);
  }

  private populateTabContextMenu(tabKey: string): void {
    const tracked = this.trackedTabsByKey.get(tabKey);
    if (!tracked || !this.contextMenu) {
      return;
    }

    this.commandController
      .getContextMenuItems(tracked.tabId)
      .forEach((item) =>
        this.contextMenu?.appendChild(this.renderContextMenuItem(item)),
      );

    this.appendSeparator();
    this.appendMenuItem(getString("create-group"), () => {
      this.openGroupNamePanel(tracked.title, (name) => {
        this.groupStore.createGroupFromTab(tracked, name);
      });
    });

    const groups = this.groupStore.getGroups();
    if (groups.length > 0) {
      this.appendGroupSubmenu(
        getString("add-to-group"),
        groups,
        (group) => () => this.groupStore.addTabToGroup(group.id, tracked),
      );
    }
  }

  private populateGroupMemberContextMenu(
    groupId: string,
    memberKey: string,
  ): void {
    const group = this.groupStore.findGroupById(groupId);
    const member =
      group?.members.find((item) => item.key === memberKey) ?? null;
    if (!group || !member || !this.contextMenu) {
      return;
    }

    const liveTab = this.trackedTabsByMemberKey.get(member.key) ?? null;
    if (liveTab) {
      this.commandController
        .getContextMenuItems(liveTab.tabId)
        .forEach((item) =>
          this.contextMenu?.appendChild(this.renderContextMenuItem(item)),
        );
      this.appendSeparator();
    }

    this.appendMenuItem(getString("remove-from-group"), () => {
      this.groupStore.removeMember(group.id, member.key);
    });
  }

  private populateGroupHeaderContextMenu(groupId: string): void {
    const group = this.groupStore.findGroupById(groupId);
    if (!group) {
      return;
    }

    this.appendMenuItem(getString("open-group-all"), async () => {
      await this.openGroupMembers(group.id);
    });
    this.appendMenuItem(getString("open-group-only"), async () => {
      await this.openGroupMembers(group.id, { closeOthers: true });
    });
    this.appendMenuItem(getString("expand-only-group"), () => {
      this.groupStore.expandOnly(group.id);
    });
    this.appendSeparator();
    this.appendMenuItem(
      group.collapsed ? getString("expand-group") : getString("collapse-group"),
      () => this.groupStore.toggleCollapsed(group.id),
    );
    this.appendMenuItem(getString("rename-group"), () => {
      this.openGroupNamePanel(group.name, (nextName) => {
        this.groupStore.renameGroup(group.id, nextName);
      });
    });
    this.appendColorSubmenu(group.id, group.color);
    this.appendSeparator();
    this.appendMenuItem(getString("dissolve-group"), () => {
      this.groupStore.dissolveGroup(group.id);
    });
  }

  private renderContextMenuItem(item: TabCommandItem): XULElement {
    return this.createMenuItem(
      item.label,
      async () => {
    this.hideContextMenu();
        if (item.disabled) {
          return;
        }
        await item.handler();
      },
      Boolean(item.disabled),
    );
  }

  private appendMenuItem(
    label: string,
    handler: () => void | Promise<void>,
    disabled = false,
  ): void {
    this.contextMenu?.appendChild(
      this.createMenuItem(label, handler, disabled),
    );
  }

  private appendSeparator(): void {
    if (!this.contextMenu || !this.contextMenu.firstChild) {
      return;
    }

    this.contextMenu.appendChild(
      ztoolkit.createXULElement(this.document, "menuseparator"),
    );
  }

  private appendGroupSubmenu(
    label: string,
    groups: VirtualGroup[],
    handlerFactory: (group: VirtualGroup) => () => void,
  ): void {
    if (!this.contextMenu || groups.length === 0) {
      return;
    }

    const menu = ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute("label", label);
    const popup = ztoolkit.createXULElement(this.document, "menupopup");

    groups.forEach((group) => {
      popup.appendChild(
        this.createMenuItem(
          group.name,
          handlerFactory(group),
          false,
          group.color,
        ),
      );
    });

    menu.appendChild(popup);
    this.contextMenu.appendChild(menu);
  }

  private appendColorSubmenu(groupId: string, currentColor: string): void {
    if (!this.contextMenu) {
      return;
    }

    const menu = ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute("label", getString("change-group-color"));
    const popup = ztoolkit.createXULElement(this.document, "menupopup");

    const palette = getGroupColorPalette();
    palette.forEach((color, index) => {
      popup.appendChild(
        this.createMenuItem(
          `${getString("group-color")} ${index + 1}`,
          () => this.groupStore.setColor(groupId, color),
          color === currentColor,
          color,
        ),
      );
    });

    menu.appendChild(popup);
    this.contextMenu.appendChild(menu);
  }

  private createMenuItem(
    label: string,
    handler: () => void | Promise<void>,
    disabled = false,
    color?: string,
  ): XULElement {
    const menuItem = ztoolkit.createXULElement(this.document, "menuitem");
    menuItem.setAttribute("label", label);
    menuItem.addEventListener("command", async () => {
    this.hideContextMenu();
      if (disabled) {
        return;
      }
      await handler();
    });

    if (disabled) {
      menuItem.setAttribute("disabled", "true");
    }
    if (color) {
      menuItem.setAttribute("style", `color:${color};`);
    }

    return menuItem;
  }

  private hideContextMenu(): void {
    if (!this.contextMenu) {
      return;
    }

    this.contextMenu.hidePopup();
    while (this.contextMenu.firstChild) {
      this.contextMenu.removeChild(this.contextMenu.firstChild);
    }
  }

  private commitDrop(
    targetTabKey: string | null,
    position: DropPosition,
  ): void {
    const sourceTabKey = this.draggedTabKey;

    if (!sourceTabKey || !targetTabKey || sourceTabKey === targetTabKey) {
      this.clearDragState();
      return;
    }

    if (this.isNoOpDropTarget(targetTabKey, position, sourceTabKey)) {
      this.clearDragState();
      return;
    }

    const sourceTab = this.trackedTabsByKey.get(sourceTabKey);
    const targetTab = this.trackedTabsByKey.get(targetTabKey);
    if (!sourceTab?.tabId || !targetTab?.tabId) {
      return;
    }

    const targetIndex = targetTab.nativeIndex + (position === "after" ? 1 : 0);
    this.clearDragState();
    this.commandController.moveOpenTabs([sourceTab.tabId], targetIndex);
    this.tracker.reconcile(`sidebar-move:${sourceTab.tabId}:${targetIndex}`);
    this.tracker.scheduleDelayedReconcile(
      `sidebar-move:${sourceTab.tabId}:${targetIndex}`,
      [80, 220],
    );
  }

  private commitGroupMemberDrop(
    targetGroupId: string | null,
    targetMemberKey: string | null,
    position: DropPosition,
  ): void {
    const sourceGroupId = this.draggedGroupId;
    const sourceMemberKey = this.draggedMemberKey;

    if (
      !sourceGroupId ||
      !sourceMemberKey ||
      !targetGroupId ||
      !targetMemberKey ||
      sourceGroupId !== targetGroupId ||
      sourceMemberKey === targetMemberKey
    ) {
      this.clearDragState();
      return;
    }

    if (
      this.isNoOpGroupMemberDropTarget(
        targetGroupId,
        targetMemberKey,
        position,
        sourceGroupId,
        sourceMemberKey,
      )
    ) {
      this.clearDragState();
      return;
    }

    this.clearDragState();
    this.groupStore.reorderMember(
      sourceGroupId,
      sourceMemberKey,
      targetMemberKey,
      position,
    );
  }


  private commitGroupHeaderDrop(
    targetGroupId: string | null,
    position: DropPosition,
  ): void {
    const sourceGroupId = this.draggedHeaderGroupId;

    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
      this.clearDragState();
      return;
    }

    if (this.isNoOpGroupHeaderDropTarget(targetGroupId, position, sourceGroupId)) {
      this.clearDragState();
      return;
    }

    this.clearDragState();
    this.groupStore.reorderGroup(sourceGroupId, targetGroupId, position);
  }

  private getDropPosition(row: HTMLDivElement, event: DragEvent): DropPosition {
    const rect = row.getBoundingClientRect();
    const pointerY = event.clientY ?? rect.top;
    const middleY = rect.top + rect.height / 2;
    const rowTabKey = row.dataset.tabKey ?? null;
    const rowGroupId = row.dataset.groupId ?? null;
    const rowMemberKey = row.dataset.memberKey ?? null;

    if (
      this.draggedHeaderGroupId &&
      rowGroupId === this.dragOverHeaderGroupId &&
      !rowMemberKey &&
      this.dragOverPosition &&
      Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
    ) {
      return this.dragOverPosition;
    }

    if (
      this.draggedGroupId &&
      rowGroupId === this.dragOverGroupId &&
      rowMemberKey === this.dragOverMemberKey &&
      this.dragOverPosition &&
      Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
    ) {
      return this.dragOverPosition;
    }

    if (
      this.draggedTabKey &&
      rowTabKey &&
      rowTabKey === this.dragOverTabKey &&
      this.dragOverPosition &&
      Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
    ) {
      return this.dragOverPosition;
    }

    return pointerY < middleY ? "before" : "after";
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
    this.render(this.tracker.getSnapshot());
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
      groupId !== this.draggedGroupId ||
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
    this.render(this.tracker.getSnapshot());
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
    this.render(this.tracker.getSnapshot());
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
    this.render(this.tracker.getSnapshot());
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
    if (!this.listContainer) {
      return;
    }

    const rows = this.listContainer.querySelectorAll(
      '.tab-enhance-vertical-tab-row[data-sortable="true"]',
    );
    rows.forEach((node: Element) => {
      const row = node as HTMLDivElement;
      row.classList.remove("is-dragging");
      const rowTabKey = row.dataset.tabKey ?? null;
      const rowMemberKey = row.dataset.memberKey ?? null;
      const rowGroupId = row.dataset.groupId ?? null;
      if (rowTabKey && rowTabKey === this.draggedTabKey && !rowGroupId) {
        row.classList.add("is-dragging");
      }
      if (
        rowGroupId &&
        rowGroupId === this.draggedGroupId &&
        rowMemberKey &&
        rowMemberKey === this.draggedMemberKey
      ) {
        row.classList.add("is-dragging");
      }
    });

    const headers = this.listContainer.querySelectorAll(
      '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
    );
    headers.forEach((node: Element) => {
      const header = node as HTMLDivElement;
      header.classList.remove("is-dragging");
      const groupId = header.dataset.groupId ?? null;
      if (groupId && groupId === this.draggedHeaderGroupId) {
        header.classList.add("is-dragging");
      }
    });
  }

  private resolveDropTargetFromPoint(
    clientY: number,
  ): { tabKey: string | null; position: DropPosition } | null {
    if (!this.listContainer) {
      return null;
    }

    const rows = Array.from(
      this.listContainer.querySelectorAll(
        '.tab-enhance-vertical-tab-row[data-sortable="true"][data-sort-kind="tabs"]',
      ),
    ) as HTMLDivElement[];
    if (!rows.length) {
      return null;
    }

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      if (clientY < middleY) {
        return {
          tabKey: row.dataset.tabKey ?? null,
          position: "before",
        };
      }
    }

    const lastRow = rows[rows.length - 1];
    return {
      tabKey: lastRow.dataset.tabKey ?? null,
      position: "after",
    };
  }

  private getSortableRowFromEventTarget(
    target: EventTarget | null,
  ): HTMLDivElement | null {
    const elementCtor = this.window.Element;
    if (!elementCtor || !target || !(target instanceof elementCtor)) {
      return null;
    }

    const row = (target as Element).closest(
      '.tab-enhance-vertical-tab-row[data-sortable="true"][data-sort-kind="tabs"]',
    );
    return row ? (row as HTMLDivElement) : null;
  }


  private resolveGroupHeaderDropTargetFromPoint(
    clientY: number,
  ): { groupId: string | null; position: DropPosition } | null {
    if (!this.listContainer) {
      return null;
    }

    const groups = Array.from(
      this.listContainer.querySelectorAll('.tab-enhance-vertical-group[data-group-id]'),
    ) as HTMLDivElement[];
    if (!groups.length) {
      return null;
    }

    const firstGroup = groups[0];
    const firstRect = firstGroup.getBoundingClientRect();
    if (clientY < firstRect.top) {
      return {
        groupId: firstGroup.dataset.groupId ?? null,
        position: "before",
      };
    }

    for (const group of groups) {
      const groupId = group.dataset.groupId ?? null;
      const header = group.querySelector(
        '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
      ) as HTMLDivElement | null;
      if (!groupId || !header) {
        continue;
      }

      const groupRect = group.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const headerMidY = headerRect.top + headerRect.height / 2;
      const footerZoneTop = Math.max(
        headerRect.bottom + 12,
        groupRect.bottom - 16,
      );

      if (clientY >= groupRect.top && clientY <= groupRect.bottom) {
        if (clientY <= headerMidY) {
          return {
            groupId,
            position: "before",
          };
        }
        if (clientY >= footerZoneTop) {
          return {
            groupId,
            position: "after",
          };
        }
        return null;
      }
    }

    const lastGroup = groups[groups.length - 1];
    return {
      groupId: lastGroup.dataset.groupId ?? null,
      position: "after",
    };
  }

  private getSortableGroupHeaderFromEventTarget(
    target: EventTarget | null,
  ): HTMLDivElement | null {
    const elementCtor = this.window.Element;
    if (!elementCtor || !target || !(target instanceof elementCtor)) {
      return null;
    }

    const header = (target as Element).closest(
      '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
    );
    return header ? (header as HTMLDivElement) : null;
  }

  private promptForGroupName(defaultValue: string): string | null {
    const value = this.window.prompt(
      getString("group-name-prompt"),
      defaultValue,
    );
    if (value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized || getString("new-group");
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
    input: Pick<TrackedTab | VirtualGroupMember, "title" | "itemID" | "parentItemID">,
  ): string {
    const mode = getPref("verticalTabTitleMode");
    if (mode === "shortTitle") {
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
    const mode = getPref("verticalTabSubtitleMode");
    switch (mode) {
      case "none":
        return "";
      case "typeAndItem":
        return this.getLegacyMetaText(input);
      case "creatorYear":
        return (
          this.getCreatorYearText(this.getDisplayItem(input)) ||
          this.getSourceText(this.getDisplayItem(input)) ||
          this.getLegacyMetaText(input)
        );
      case "source":
      default:
        return (
          this.getSourceText(this.getDisplayItem(input)) ||
          this.getCreatorYearText(this.getDisplayItem(input)) ||
          this.getLegacyMetaText(input)
        );
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
    if (this.displayItemCache.has(cacheKey)) {
      return this.displayItemCache.get(cacheKey) ?? null;
    }
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (item) {
        this.displayItemCache.set(cacheKey, item);
        return item;
      }
    }
    this.displayItemCache.set(cacheKey, null);
    return null;
  }

  private getItemField(item: any | null, fields: string[]): string {
    if (!item) {
      return "";
    }
    for (const field of fields) {
      const cacheKey =
        typeof item.id === "number" ? `${item.id}:${field}` : `unknown:${field}`;
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
    this.displayItemCache.clear();
    this.itemFieldCache.clear();
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
}
