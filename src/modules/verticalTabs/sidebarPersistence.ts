import { getString } from "../../utils/locale";
import {
  getGroupColorPalette,
  getJSONPref,
  getRawPref,
  setJSONPref,
} from "../../utils/prefs";
import TabGroupStore from "./groupStore";
import {
  RestoredSidebarState,
  SIDEBAR,
  SIDEBAR_PREF_KEYS,
  SidebarStateSnapshot,
  SidebarViewMode,
} from "./sidebarCommon";
import { SidebarState, TrackedTab, VirtualGroup } from "./types";

export async function restoreSidebarState(
  tabs: Pick<TrackedTab, "itemID" | "parentItemID">[] = [],
): Promise<RestoredSidebarState> {
  const sidebarState =
    getJSONPref<Partial<SidebarState> | null>(
      SIDEBAR_PREF_KEYS.SIDEBAR_STATE,
      {},
    ) ?? {};

  let collapsed = false;
  if (typeof sidebarState.collapsed === "boolean") {
    collapsed = sidebarState.collapsed;
  }

  let expandedWidth: number = SIDEBAR.DEFAULT_EXPANDED_WIDTH;
  if (
    typeof sidebarState.width === "number" &&
    Number.isFinite(sidebarState.width) &&
    sidebarState.width >= SIDEBAR.MIN_WIDTH
  ) {
    expandedWidth = Math.round(sidebarState.width);
  }

  let searchQuery = "";
  if (typeof sidebarState.searchQuery === "string") {
    searchQuery = sidebarState.searchQuery;
  }

  let viewMode: SidebarViewMode = "default";
  if (isSidebarViewMode(sidebarState.viewMode)) {
    viewMode = sidebarState.viewMode;
  }

  const rawGroups = getRawPref<string | null>(
    SIDEBAR_PREF_KEYS.GROUPS_STATE,
    null,
  );
  const savedGroups: unknown = rawGroups == null ? [] : JSON.parse(rawGroups);
  if (!Array.isArray(savedGroups)) {
    throw new Error("Invalid saved vertical tab groups");
  }
  const groups = sanitizeGroups(savedGroups);
  const itemIDs = new Set<number>();
  for (const member of [...groups.flatMap((group) => group.members), ...tabs]) {
    for (const id of [member.itemID, member.parentItemID]) {
      if (typeof id === "number" && Zotero.Items.exists(id)) {
        itemIDs.add(id);
      }
    }
  }
  if (itemIDs.size) {
    const items = await Zotero.Items.getAsync([...itemIDs]);
    const parentIDs = new Set<number>();
    for (const item of items) {
      const parentID = item.parentItemID;
      if (
        typeof parentID === "number" &&
        !itemIDs.has(parentID) &&
        Zotero.Items.exists(parentID)
      ) {
        parentIDs.add(parentID);
      }
    }
    if (parentIDs.size) {
      items.push(...(await Zotero.Items.getAsync([...parentIDs])));
    }
    await Zotero.Items.loadDataTypes(items, ["itemData", "creators"]);
    const itemsByID = new Map(items.map((item) => [item.id, item]));
    for (const group of groups) {
      for (const member of group.members) {
        if (member.itemID != null && member.parentItemID == null) {
          const parentID = itemsByID.get(member.itemID)?.parentItemID;
          if (typeof parentID === "number") {
            member.parentItemID = parentID;
          }
        }
      }
    }
  }

  return {
    collapsed,
    expandedWidth,
    searchQuery,
    viewMode,
    groups: sanitizeGroups(groups),
  };
}

export function persistSidebarState(state: SidebarStateSnapshot): void {
  const persistedState: SidebarState = {
    collapsed: state.collapsed,
    width: state.width,
    searchQuery: state.searchQuery,
    selectedKeys: state.selectedKeys,
    viewMode: state.viewMode,
  };
  setJSONPref(SIDEBAR_PREF_KEYS.SIDEBAR_STATE, persistedState);
}

export function persistGroupsState(groupStore: TabGroupStore): void {
  setJSONPref(SIDEBAR_PREF_KEYS.GROUPS_STATE, groupStore.getGroups());
}

export function sanitizeGroups(groups: VirtualGroup[]): VirtualGroup[] {
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
        (itemID != null && Zotero.Items.exists(itemID)) ||
        (parentItemID != null && Zotero.Items.exists(parentItemID));

      if ((itemID != null || parentItemID != null) && !hasResolvableItem) {
        return [];
      }

      const memberKey =
        typeof member.key === "string" && member.key.trim() ? member.key : null;
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
            : getGroupColorPalette()[
                groupIndex % getGroupColorPalette().length
              ],
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

export function isSidebarViewMode(value: unknown): value is SidebarViewMode {
  return value === "default" || value === "recent" || value === "type";
}
