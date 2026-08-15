export interface TrackedTab {
  // Stable plugin key. Open tabs use `tab:${tabId}`.
  key: string;
  tabId: string | null;
  type: string;
  title: string;
  itemID: number | null;
  parentItemID: number | null;
  isOpen: boolean;
  isSelected: boolean;
  nativeIndex: number;
  openedAt: number | null;
  iconKey: string;
}

export interface SidebarState {
  collapsed: boolean;
  width: number | null;
  searchQuery: string;
  selectedKeys: string[];
  viewMode: "default" | "recent" | "type";
}

export interface VirtualGroupMember {
  id: string;
  key: string;
  sourceTabKey: string | null;
  tabId: string | null;
  type: string;
  title: string;
  itemID: number | null;
  parentItemID: number | null;
  isOpen: boolean;
  openedAt: number | null;
  iconKey: string;
}

export interface VirtualGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  sortMode: "manual" | "recent" | "type";
  members: VirtualGroupMember[];
}

export interface TabTrackerSnapshot {
  tabs: TrackedTab[];
  selectedTabKey: string | null;
}

export const LIBRARY_TAB_ID = "zotero-pane";

export const GROUP_COLOR_PALETTE = [
  "#F6B433",
  "#E36D6D",
  "#5C8DF6",
  "#4FB286",
  "#9A6AF0",
  "#E28A3B",
  "#38AFC7",
  "#D65A9E",
] as const;

export function makeVirtualMemberKey(input: {
  itemID?: number | null;
  parentItemID?: number | null;
  tabId?: string | null;
  type?: string | null;
  title?: string | null;
}): string {
  if (typeof input.itemID === "number") {
    return `item:${input.itemID}`;
  }

  if (typeof input.parentItemID === "number") {
    return `parent:${input.parentItemID}:${input.type ?? "tab"}`;
  }

  if (input.tabId) {
    return `tab:${input.tabId}`;
  }

  const fallbackTitle = input.title?.trim() || "unknown";
  return `fallback:${input.type ?? "tab"}:${fallbackTitle}`;
}

export function makeVirtualMemberLookupKeys(input: {
  itemID?: number | null;
  parentItemID?: number | null;
  tabId?: string | null;
  type?: string | null;
  title?: string | null;
}): string[] {
  const keys = new Set<string>([makeVirtualMemberKey(input)]);

  if (typeof input.parentItemID === "number") {
    keys.add(`parent:${input.parentItemID}:${input.type ?? "tab"}`);
    keys.add(`item:${input.parentItemID}`);
  }

  return Array.from(keys);
}
