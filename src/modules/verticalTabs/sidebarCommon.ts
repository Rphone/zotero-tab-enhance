import { SidebarState, TrackedTab, VirtualGroup, VirtualGroupMember } from "./types";

export const SIDEBAR = {
  DEFAULT_EXPANDED_WIDTH: 260,
  COLLAPSED_WIDTH: 44,
  MIN_WIDTH: 160,
  ROW_HEIGHT: 72,
  ANIMATION_DURATION_MS: 250,
  SEARCH_DEBOUNCE_MS: 200,
  RENDER_DEBOUNCE_MS: 32,
  READER_METADATA_DEFER_MS: 1000,
  READER_REOPEN_SETTLE_MS: 120,
  DROP_HYSTERESIS: 8,
} as const;

export const SIDEBAR_PREF_KEYS = {
  SIDEBAR_STATE: "verticalTabs.sidebarState",
  GROUPS_STATE: "verticalTabs.groups",
} as const;

export type DropPosition = "before" | "after";
export type SidebarViewMode = "default" | "recent" | "type";

export type ContextMenuTarget =
  | { kind: "tab"; tabKey: string }
  | { kind: "group-header"; groupId: string }
  | { kind: "group-member"; groupId: string; memberKey: string };

export type RenderableGroup = {
  group: VirtualGroup;
  members: VirtualGroupMember[];
};

export type AggregateSection = {
  id: string;
  title: string;
  tabs: TrackedTab[];
};

export type InlineGroupNameEditor =
  | { kind: "create"; sourceTab: TrackedTab; value: string }
  | { kind: "rename"; groupId: string; value: string };

export type DeferredReaderLoadTab = {
  tabId: string;
  type?: string;
  title?: string;
  itemID?: number | null;
};

export interface SidebarElements {
  sidebar: XULElement;
  splitter: XULElement;
  toggleButton: XULElement;
  createGroupButton: HTMLButtonElement;
  viewSwitcher: HTMLElement;
  headerTitle: HTMLElement;
  countBadge: HTMLElement;
  listContainer: HTMLElement;
  searchInput: HTMLInputElement;
  contextMenu: XULPopupElement;
  stylesheet: HTMLElement;
  themeCleanup?: () => void;
}

export type RestoredSidebarState = {
  collapsed: boolean;
  expandedWidth: number;
  searchQuery: string;
  viewMode: SidebarViewMode;
  groups: VirtualGroup[];
};

export type SidebarStateSnapshot = Pick<
  SidebarState,
  "collapsed" | "searchQuery" | "selectedKeys" | "viewMode"
> & {
  width: number;
};
