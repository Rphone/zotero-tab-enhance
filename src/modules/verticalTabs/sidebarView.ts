import { getString } from "../../utils/locale";
import { getGroupColorPalette, getPref } from "../../utils/prefs";
import TabGroupStore from "./groupStore";
import { setCollapsibleMeasuredHeight, syncCollapsibleState } from "./collapsible";
import {
  AggregateSection,
  InlineGroupNameEditor,
  RenderableGroup,
  SIDEBAR,
  SidebarViewMode,
} from "./sidebarCommon";
import {
  LIBRARY_TAB_ID,
  TabTrackerSnapshot,
  TrackedTab,
  VirtualGroupMember,
} from "./types";

export interface SidebarRenderState {
  collapsed: boolean;
  searchQuery: string;
  viewMode: SidebarViewMode;
  selectedTabKey: string | null;
  groupNameEditor: InlineGroupNameEditor | null;
  draggedTabKey: string | null;
  draggedGroupId: string | null;
  draggedMemberKey: string | null;
  draggedHeaderGroupId: string | null;
  dragOverTabKey: string | null;
  dragOverGroupId: string | null;
  dragOverMemberKey: string | null;
  dragOverHeaderGroupId: string | null;
  dragOverPosition: "before" | "after" | null;
  metadataDeferred: boolean;
  trackedTabsByKey: Map<string, TrackedTab>;
  trackedTabsByMemberKey: Map<string, TrackedTab>;
}

export interface SidebarViewHandlers {
  hideContextMenu: () => void;
  updateViewSwitcher: () => void;
  clearDragState: () => void;
  requestGroupCollapsedToggle: (
    groupId: string,
    isCurrentlyCollapsed: boolean,
    container: HTMLDivElement,
  ) => void;
  rowClick: (event: MouseEvent) => void;
  rowKeyDown: (event: KeyboardEvent) => void;
  rowContextMenu: (event: MouseEvent) => void;
  virtualMemberContextMenu: (event: MouseEvent) => void;
  virtualMemberClick: (event: MouseEvent) => void;
  virtualMemberKeyDown: (event: KeyboardEvent) => void;
  rowDragStart: (event: DragEvent) => void;
  rowDragOver: (event: DragEvent) => void;
  rowDrop: (event: DragEvent) => void;
  rowDragEnd: () => void;
  groupHeaderDragStart: (event: DragEvent) => void;
  groupHeaderDragOver: (event: DragEvent) => void;
  groupHeaderDrop: (event: DragEvent) => void;
  groupHeaderDragEnd: () => void;
  groupHeaderContextMenu: (event: MouseEvent) => void;
  groupNameEditorInput: (value: string) => void;
  commitInlineGroupNameEditor: () => void;
  cancelInlineGroupNameEditor: () => void;
  closeTab: (tabId: string | null) => void;
}

export default class SidebarViewRenderer {
  private readonly displayItemIDCache = new Map<string, number | null>();
  private readonly itemFieldCache = new Map<string, string>();
  private displayTitleMode = "title";
  private displaySubtitleMode = "source";

  constructor(
    private readonly window: _ZoteroTypes.MainWindow,
    private readonly document: Document,
    private readonly groupStore: TabGroupStore,
  ) {}

  public render(
    snapshot: TabTrackerSnapshot,
    state: SidebarRenderState,
    elements: {
      listContainer?: HTMLElement;
      countBadge?: HTMLElement;
      headerTitle?: HTMLElement;
    },
    handlers: SidebarViewHandlers,
  ): void {
    if (!elements.listContainer || !elements.countBadge || !elements.headerTitle) {
      return;
    }

    const openTabs = snapshot.tabs
      .map((tab) => this.normalizeTab(tab))
      .filter((tab) => this.shouldRenderTab(tab));

    const renderableGroups =
      state.viewMode === "default"
        ? this.getRenderableGroups(openTabs, state.searchQuery, state.trackedTabsByMemberKey)
        : [];
    const visibleUngroupedTabs =
      state.viewMode === "default"
        ? this.groupStore
            .getUngroupedTabs(openTabs)
            .filter((tab) => this.matchesSearch(tab, state.searchQuery))
        : [];
    const aggregateSections =
      state.viewMode === "default"
        ? []
        : this.getAggregateSections(openTabs, state.searchQuery, state.viewMode);

    handlers.hideContextMenu();
    handlers.updateViewSwitcher();
    elements.headerTitle.textContent = this.getViewTitle(state.viewMode);
    elements.countBadge.textContent = String(openTabs.length);
    elements.listContainer.textContent = "";

    if (
      state.draggedTabKey &&
      (state.viewMode !== "default" ||
        !visibleUngroupedTabs.some((tab) => tab.key === state.draggedTabKey))
    ) {
      handlers.clearDragState();
    }

    if (
      state.draggedGroupId &&
      state.draggedMemberKey &&
      !renderableGroups.some(
        (group) =>
          group.group.id === state.draggedGroupId &&
          group.members.some((member) => member.key === state.draggedMemberKey),
      )
    ) {
      handlers.clearDragState();
    }

    if (
      state.draggedHeaderGroupId &&
      !renderableGroups.some(
        (group) => group.group.id === state.draggedHeaderGroupId,
      )
    ) {
      handlers.clearDragState();
    }

    const hasDefaultContent =
      renderableGroups.length > 0 ||
      visibleUngroupedTabs.length > 0 ||
      Boolean(state.groupNameEditor);
    const hasAggregateContent = aggregateSections.some(
      (section) => section.tabs.length > 0,
    );

    if (
      (state.viewMode === "default" && !hasDefaultContent) ||
      (state.viewMode !== "default" && !hasAggregateContent)
    ) {
      const emptyState = ztoolkit.UI.createElement(this.document, "div", {
        namespace: "html",
        classList: ["tab-enhance-vertical-tabs-empty"],
        properties: {
          textContent: state.searchQuery
            ? getString("no-matching-tabs")
            : state.collapsed
              ? "0"
              : "No tabs open",
        },
      }) as HTMLDivElement;
      elements.listContainer.appendChild(emptyState);
      return;
    }

    if (state.viewMode === "default") {
      if (state.groupNameEditor?.kind === "create") {
        elements.listContainer.appendChild(
          this.renderCreateGroupEditor(state.groupNameEditor, handlers),
        );
      }

      renderableGroups.forEach((renderableGroup) => {
        if (
          renderableGroup.group.id === state.dragOverHeaderGroupId &&
          state.dragOverPosition === "before"
        ) {
          elements.listContainer?.appendChild(this.renderDropPlaceholder());
        }

        elements.listContainer?.appendChild(
          this.renderGroupSection(renderableGroup, state, handlers),
        );

        if (
          renderableGroup.group.id === state.dragOverHeaderGroupId &&
          state.dragOverPosition === "after"
        ) {
          elements.listContainer?.appendChild(this.renderDropPlaceholder());
        }
      });

      visibleUngroupedTabs.forEach((tab) => {
        if (tab.key === state.dragOverTabKey && state.dragOverPosition === "before") {
          elements.listContainer?.appendChild(this.renderDropPlaceholder());
        }

        elements.listContainer?.appendChild(
          this.renderTabRow(tab, state, handlers, {
            sortable: true,
            grouped: false,
          }),
        );

        if (tab.key === state.dragOverTabKey && state.dragOverPosition === "after") {
          elements.listContainer?.appendChild(this.renderDropPlaceholder());
        }
      });
      return;
    }

    aggregateSections.forEach((section) => {
      if (!section.tabs.length) {
        return;
      }
      elements.listContainer?.appendChild(
        this.renderAggregateSection(section, state, handlers),
      );
    });
  }

  public refreshDisplayModeCache(): void {
    this.displayTitleMode = getPref("verticalTabTitleMode");
    this.displaySubtitleMode = getPref("verticalTabSubtitleMode");
  }

  public clearDisplayMetadataCache(): void {
    this.displayItemIDCache.clear();
    this.itemFieldCache.clear();
  }

  public normalizeTab(tab: TrackedTab): TrackedTab {
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

  public shouldRenderTab(tab: TrackedTab): boolean {
    return !(
      tab.tabId === LIBRARY_TAB_ID ||
      tab.type === "library" ||
      tab.type === "zotero-pane"
    );
  }

  public getVisibleSortableTabs(
    snapshot: TabTrackerSnapshot,
    searchQuery: string,
  ): TrackedTab[] {
    return this.groupStore
      .getUngroupedTabs(
        snapshot.tabs
          .map((tab) => this.normalizeTab(tab))
          .filter((tab) => this.shouldRenderTab(tab)),
      )
      .filter((tab) => this.matchesSearch(tab, searchQuery));
  }

  private getViewTitle(viewMode: SidebarViewMode): string {
    switch (viewMode) {
      case "recent":
        return getString("view-recent");
      case "type":
        return getString("view-type");
      default:
        return getString("view-default");
    }
  }

  private getAggregateSections(
    openTabs: TrackedTab[],
    searchQuery: string,
    viewMode: SidebarViewMode,
  ): AggregateSection[] {
    const filteredTabs = openTabs.filter((tab) =>
      this.matchesSearch(tab, searchQuery),
    );
    if (viewMode === "recent") {
      return this.buildRecentSections(filteredTabs);
    }
    if (viewMode === "type") {
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
    state: SidebarRenderState,
    handlers: SidebarViewHandlers,
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
        this.renderTabRow(tab, state, handlers, {
          sortable: false,
          grouped: false,
        }),
      );
    });

    return container;
  }

  private renderGroupSection(
    renderable: RenderableGroup,
    state: SidebarRenderState,
    handlers: SidebarViewHandlers,
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
      state.groupNameEditor?.kind === "rename" &&
      state.groupNameEditor.groupId === renderable.group.id;

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
            handlers.requestGroupCollapsedToggle(
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
            handlers.requestGroupCollapsedToggle(
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
            handlers.groupHeaderContextMenu(mouseEvent);
          },
        },
        { type: "dragstart", listener: handlers.groupHeaderDragStart },
        { type: "dragover", listener: handlers.groupHeaderDragOver },
        { type: "drop", listener: handlers.groupHeaderDrop },
        { type: "dragend", listener: handlers.groupHeaderDragEnd },
      ],
    }) as HTMLDivElement;

    header.dataset.groupId = renderable.group.id;
    header.dataset.sortable = isEditingGroupName ? "false" : "true";
    header.dataset.sortKind = "groups";
    if (renderable.group.id === state.draggedHeaderGroupId) {
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
      ? this.renderInlineGroupNameEditor(state.groupNameEditor, handlers)
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
    syncCollapsibleState(members, renderable.group.collapsed);

    renderable.members.forEach((member) => {
      if (
        renderable.group.id === state.dragOverGroupId &&
        member.key === state.dragOverMemberKey &&
        state.dragOverPosition === "before"
      ) {
        members.appendChild(this.renderDropPlaceholder());
      }

      members.appendChild(
        this.renderGroupMemberRow(member, renderable.group.id, state, handlers),
      );

      if (
        renderable.group.id === state.dragOverGroupId &&
        member.key === state.dragOverMemberKey &&
        state.dragOverPosition === "after"
      ) {
        members.appendChild(this.renderDropPlaceholder());
      }
    });

    container.appendChild(members);
    return container;
  }

  private getRenderableGroups(
    openTabs: TrackedTab[],
    searchQuery: string,
    trackedTabsByMemberKey: Map<string, TrackedTab>,
  ): RenderableGroup[] {
    const groups = this.groupStore.getGroups();

    return groups
      .map((group) => {
        const groupNameMatches = this.matchesGroupName(group.name, searchQuery);
        const members = group.members.filter((member) => {
          if (groupNameMatches || !searchQuery) {
            return true;
          }

          const liveTab = trackedTabsByMemberKey.get(member.key) ?? null;
          return this.matchesGroupMember(liveTab ?? member, searchQuery);
        });

        if (!groupNameMatches && members.length === 0) {
          return null;
        }

        return {
          group,
          members: members.map((member) => {
            const liveTab = trackedTabsByMemberKey.get(member.key) ?? null;
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

  private renderDropPlaceholder(): HTMLElement {
    return ztoolkit.UI.createElement(this.document, "div", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tab-placeholder"],
      attributes: {
        "aria-hidden": "true",
      },
    }) as HTMLDivElement;
  }

  private renderCreateGroupEditor(
    editor: InlineGroupNameEditor,
    handlers: SidebarViewHandlers,
  ): HTMLElement {
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
    container.appendChild(this.renderInlineGroupNameEditor(editor, handlers));
    return container;
  }

  private renderInlineGroupNameEditor(
    editor: InlineGroupNameEditor | null,
    handlers: SidebarViewHandlers,
  ): HTMLElement {
    const wrapper = ztoolkit.UI.createElement(this.document, "span", {
      namespace: "html",
      classList: ["tab-enhance-inline-group-name-editor"],
      listeners: [
        { type: "click", listener: (event: Event) => event.stopPropagation() },
        { type: "mousedown", listener: (event: Event) => event.stopPropagation() },
        { type: "contextmenu", listener: (event: Event) => event.stopPropagation() },
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
            handlers.groupNameEditorInput(
              (event.target as HTMLInputElement).value,
            );
          },
        },
        {
          type: "keydown",
          listener: (event: Event) => {
            const keyboardEvent = event as KeyboardEvent;
            keyboardEvent.stopPropagation();
            if (keyboardEvent.key === "Enter") {
              keyboardEvent.preventDefault();
              handlers.commitInlineGroupNameEditor();
              return;
            }
            if (keyboardEvent.key === "Escape") {
              keyboardEvent.preventDefault();
              handlers.cancelInlineGroupNameEditor();
            }
          },
        },
        {
          type: "blur",
          listener: () => handlers.commitInlineGroupNameEditor(),
        },
      ],
    }) as HTMLInputElement;

    wrapper.appendChild(input);
    return wrapper;
  }

  private matchesSearch(tab: TrackedTab, searchQuery: string): boolean {
    if (!searchQuery) {
      return true;
    }

    const haystack =
      `${tab.title} ${this.getDisplayTitle(tab, false)} ${this.getDisplaySubtitle(tab, false)} ${this.getMetaText(tab)}`.toLocaleLowerCase();
    return haystack.includes(searchQuery);
  }

  private matchesGroupName(name: string, searchQuery: string): boolean {
    if (!searchQuery) {
      return true;
    }

    return name.toLocaleLowerCase().includes(searchQuery);
  }

  private matchesGroupMember(
    member: Pick<
      VirtualGroupMember,
      "title" | "type" | "itemID" | "parentItemID" | "isOpen"
    >,
    searchQuery: string,
  ): boolean {
    if (!searchQuery) {
      return true;
    }

    const haystack =
      `${member.title} ${this.getDisplayTitle(member, false)} ${this.getDisplaySubtitle(member, false)} ${this.getVirtualMemberMetaText(member)}`.toLocaleLowerCase();
    return haystack.includes(searchQuery);
  }

  private renderTabRow(
    tab: TrackedTab,
    state: SidebarRenderState,
    handlers: SidebarViewHandlers,
    options: {
      sortable: boolean;
      grouped: boolean;
      groupId?: string;
      memberKey?: string;
    },
  ): HTMLElement {
    const isSelected = state.selectedTabKey
      ? tab.key === state.selectedTabKey
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

    row.addEventListener("click", handlers.rowClick);
    row.addEventListener("keydown", handlers.rowKeyDown);
    row.addEventListener("contextmenu", handlers.rowContextMenu);
    if (options.sortable) {
      row.addEventListener("dragstart", handlers.rowDragStart);
      row.addEventListener("dragover", handlers.rowDragOver);
      row.addEventListener("drop", handlers.rowDrop);
      row.addEventListener("dragend", handlers.rowDragEnd);
    }

    if (isSelected) {
      row.classList.add("is-selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }

    if (
      (tab.key === state.draggedTabKey && !options.groupId) ||
      (options.groupId && options.memberKey === state.draggedMemberKey)
    ) {
      row.classList.add("is-dragging");
    }

    row.appendChild(this.renderBadge(tab.iconKey));
    if (!state.collapsed) {
      row.appendChild(
        this.renderRowContent(
          this.getDisplayTitle(tab, state.metadataDeferred),
          this.getDisplaySubtitle(tab, state.metadataDeferred),
        ),
      );
    }

    if (!state.collapsed && tab.tabId) {
      row.appendChild(
        this.renderCloseButton(() => {
          handlers.closeTab(tab.tabId);
        }),
      );
    }

    return row;
  }

  private renderGroupMemberRow(
    member: VirtualGroupMember,
    groupId: string,
    state: SidebarRenderState,
    handlers: SidebarViewHandlers,
  ): HTMLElement {
    const liveTab = state.trackedTabsByMemberKey.get(member.key) ?? null;
    if (liveTab) {
      return this.renderTabRow(liveTab, state, handlers, {
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
    row.addEventListener("click", handlers.virtualMemberClick);
    row.addEventListener("keydown", handlers.virtualMemberKeyDown);
    row.addEventListener("contextmenu", handlers.virtualMemberContextMenu);
    row.addEventListener("dragstart", handlers.rowDragStart);
    row.addEventListener("dragover", handlers.rowDragOver);
    row.addEventListener("drop", handlers.rowDrop);
    row.addEventListener("dragend", handlers.rowDragEnd);

    row.appendChild(this.renderBadge(member.iconKey));
    if (!state.collapsed) {
      row.appendChild(
        this.renderRowContent(
          this.getDisplayTitle(member, state.metadataDeferred),
          this.getDisplaySubtitle(member, state.metadataDeferred),
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
    metadataDeferred: boolean,
  ): string {
    if (metadataDeferred) {
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
    metadataDeferred: boolean,
  ): string {
    if (metadataDeferred) {
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
    member: Pick<VirtualGroupMember, "type" | "itemID" | "parentItemID" | "isOpen">,
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
}
