import {
  TrackedTab,
  VirtualGroup,
  VirtualGroupMember,
  makeVirtualMemberKey,
  makeVirtualMemberLookupKeys,
} from "./types";
import { getGroupColorPalette } from "../../utils/prefs";

type GroupStoreListener = (groups: VirtualGroup[]) => void;

export default class TabGroupStore {
  private groups: VirtualGroup[] = [];
  private listeners = new Set<GroupStoreListener>();

  constructor(_window: _ZoteroTypes.MainWindow) {
    void _window;
  }

  public subscribe(listener: GroupStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.getGroups());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public destroy(): void {
    this.groups = [];
    this.listeners.clear();
  }

  public getGroups(): VirtualGroup[] {
    return this.groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member })),
    }));
  }

  public setGroups(groups: VirtualGroup[]): void {
    this.groups = groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member })),
    }));
    this.emit();
  }

  public syncTrackedTabs(tabs: TrackedTab[]): boolean {
    const openTabsByMemberKey = new Map<string, TrackedTab>();
    tabs.forEach((tab) => {
      this.getMemberLookupKeysFromTab(tab).forEach((key) => {
        if (!openTabsByMemberKey.has(key)) {
          openTabsByMemberKey.set(key, tab);
        }
      });
    });
    let changed = false;

    this.groups = this.groups.map((group) => ({
      ...group,
      members: group.members.map((member) => {
        const liveTab = openTabsByMemberKey.get(member.key);
        if (!liveTab) {
          if (!member.isOpen || (!member.sourceTabKey && !member.tabId)) {
            return member;
          }
          changed = true;
          return {
            ...member,
            isOpen: false,
            sourceTabKey: null,
            tabId: null,
          };
        }

        const nextMember = this.makeMemberFromTab(liveTab, member.id);
        const normalizedMember = {
          ...member,
          ...nextMember,
          id: member.id,
        };
        if (!this.areMembersEqual(normalizedMember, member)) {
          changed = true;
        }
        return normalizedMember;
      }),
    }));

    if (changed) {
      this.emit();
    }
    return changed;
  }

  public createGroupFromTab(tab: TrackedTab, name?: string): VirtualGroup {
    const member = this.makeMemberFromTab(tab);

    const group: VirtualGroup = {
      id: this.makeID("group"),
      name: name?.trim() || this.buildDefaultGroupName(tab),
      color: this.pickNextColor(),
      collapsed: false,
      sortMode: "manual",
      members: [member],
    };

    this.groups = [...this.groups, group];
    this.emit();
    return { ...group, members: group.members.map((item) => ({ ...item })) };
  }

  public addTabToGroup(groupId: string, tab: TrackedTab): void {
    const member = this.makeMemberFromTab(tab);

    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const existingIndex = group.members.findIndex(
        (item) => item.key === member.key,
      );
      changed = true;
      if (existingIndex >= 0) {
        const members = [...group.members];
        members[existingIndex] = {
          ...members[existingIndex],
          ...member,
          id: members[existingIndex].id,
        };
        return {
          ...group,
          members,
        };
      }

      return {
        ...group,
        members: [...group.members, member],
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public removeMember(groupId: string, memberKey: string): void {
    let changed = false;
    this.groups = this.groups
      .map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        const members = group.members.filter(
          (member) => member.key !== memberKey,
        );
        if (members.length === group.members.length) {
          return group;
        }
        changed = true;
        return {
          ...group,
          members,
        };
      })
      .filter((group) => group.members.length > 0);

    if (changed) {
      this.emit();
    }
  }


  public reorderMember(
    groupId: string,
    sourceMemberKey: string,
    targetMemberKey: string,
    position: "before" | "after",
  ): void {
    if (!groupId || !sourceMemberKey || !targetMemberKey) {
      return;
    }

    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const sourceIndex = group.members.findIndex(
        (member) => member.key === sourceMemberKey,
      );
      const targetIndex = group.members.findIndex(
        (member) => member.key === targetMemberKey,
      );
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return group;
      }

      const members = [...group.members];
      const [sourceMember] = members.splice(sourceIndex, 1);
      let insertIndex = targetIndex;
      if (sourceIndex < targetIndex) {
        insertIndex -= 1;
      }
      if (position === "after") {
        insertIndex += 1;
      }
      insertIndex = Math.max(0, Math.min(insertIndex, members.length));

      if (members[insertIndex]?.key === sourceMember.key) {
        return group;
      }

      members.splice(insertIndex, 0, sourceMember);
      if (
        members.every((member, index) => member.id === group.members[index]?.id)
      ) {
        return group;
      }

      changed = true;
      return {
        ...group,
        members,
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public reorderGroup(
    sourceGroupId: string,
    targetGroupId: string,
    position: "before" | "after",
  ): void {
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
      return;
    }

    const sourceIndex = this.groups.findIndex(
      (group) => group.id === sourceGroupId,
    );
    const targetIndex = this.groups.findIndex(
      (group) => group.id === targetGroupId,
    );
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const groups = [...this.groups];
    const [sourceGroup] = groups.splice(sourceIndex, 1);
    let insertIndex = targetIndex;
    if (sourceIndex < targetIndex) {
      insertIndex -= 1;
    }
    if (position === "after") {
      insertIndex += 1;
    }
    insertIndex = Math.max(0, Math.min(insertIndex, groups.length));
    groups.splice(insertIndex, 0, sourceGroup);

    if (groups.every((group, index) => group.id === this.groups[index]?.id)) {
      return;
    }

    this.groups = groups;
    this.emit();
  }

  public dissolveGroup(groupId: string): void {
    const nextGroups = this.groups.filter((group) => group.id !== groupId);
    if (nextGroups.length === this.groups.length) {
      return;
    }
    this.groups = nextGroups;
    this.emit();
  }

  public renameGroup(groupId: string, name: string): void {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }

    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId || group.name === normalizedName) {
        return group;
      }
      changed = true;
      return {
        ...group,
        name: normalizedName,
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public toggleCollapsed(groupId: string): void {
    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }
      changed = true;
      return {
        ...group,
        collapsed: !group.collapsed,
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public expandOnly(groupId: string): void {
    let changed = false;
    this.groups = this.groups.map((group) => {
      const nextCollapsed = group.id === groupId ? false : true;
      if (group.collapsed === nextCollapsed) {
        return group;
      }
      changed = true;
      return {
        ...group,
        collapsed: nextCollapsed,
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public setColor(groupId: string, color: string): void {
    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId || group.color === color) {
        return group;
      }
      changed = true;
      return {
        ...group,
        color,
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public findGroupById(groupId: string): VirtualGroup | null {
    return this.getGroups().find((group) => group.id === groupId) ?? null;
  }

  public getUngroupedTabs(tabs: TrackedTab[]): TrackedTab[] {
    return [...tabs];
  }

  public makeMemberKeyFromTab(tab: TrackedTab): string {
    return makeVirtualMemberKey({
      itemID: tab.itemID,
      parentItemID: tab.parentItemID,
      tabId: tab.tabId,
      type: tab.type,
      title: tab.title,
    });
  }

  public getMemberLookupKeysFromTab(tab: TrackedTab): string[] {
    return makeVirtualMemberLookupKeys({
      itemID: tab.itemID,
      parentItemID: tab.parentItemID,
      tabId: tab.tabId,
      type: tab.type,
      title: tab.title,
    });
  }

  private buildDefaultGroupName(tab: TrackedTab): string {
    if (tab.parentItemID != null) {
      return `Group ${tab.parentItemID}`;
    }
    if (tab.itemID != null) {
      return `Group ${tab.itemID}`;
    }
    return tab.title.slice(0, 32) || "New Group";
  }

  private areMembersEqual(a: VirtualGroupMember, b: VirtualGroupMember): boolean {
    return (
      a.key === b.key &&
      a.title === b.title &&
      a.type === b.type &&
      a.itemID === b.itemID &&
      a.parentItemID === b.parentItemID &&
      a.isOpen === b.isOpen &&
      a.sourceTabKey === b.sourceTabKey &&
      a.tabId === b.tabId &&
      a.iconKey === b.iconKey
    );
  }

  private makeMemberFromTab(
    tab: TrackedTab,
    id = this.makeID("member"),
  ): VirtualGroupMember {
    return {
      id,
      key: this.makeMemberKeyFromTab(tab),
      sourceTabKey: tab.key,
      tabId: tab.tabId,
      type: tab.type,
      title: tab.title,
      itemID: tab.itemID,
      parentItemID: tab.parentItemID,
      isOpen: tab.isOpen,
      openedAt: tab.openedAt,
      iconKey: tab.iconKey,
    };
  }

  private pickNextColor(): string {
    const palette = getGroupColorPalette();
    return palette[this.groups.length % palette.length];
  }

  private makeID(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private emit(): void {
    const snapshot = this.getGroups();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        ztoolkit.log("TabGroupStore listener failed", error);
      }
    });
  }
}
