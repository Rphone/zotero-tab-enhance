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
        const liveTab = this.getMemberLookupKeysFromMember(member)
          .map((key) => openTabsByMemberKey.get(key) ?? null)
          .find((tab): tab is TrackedTab => Boolean(tab));
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
    const group = this.createGroupFromTabs([tab], name);
    if (!group) {
      throw new Error("Failed to create group from tab");
    }
    return group;
  }

  public createGroupFromTabs(
    tabs: TrackedTab[],
    name?: string,
  ): VirtualGroup | null {
    const members = tabs
      .map((tab) => this.makeMemberFromTab(tab))
      .filter((member, index, allMembers) =>
        allMembers.findIndex((item) => item.key === member.key) === index,
      );
    if (!members.length) {
      return null;
    }

    const group: VirtualGroup = {
      id: this.makeID("group"),
      name: name?.trim() || this.buildDefaultGroupName(tabs[0]),
      color: this.pickNextColor(),
      collapsed: false,
      sortMode: "manual",
      members,
    };

    this.groups = [...this.groups, group];
    this.emit();
    return { ...group, members: group.members.map((item) => ({ ...item })) };
  }

  public addTabToGroup(
    groupId: string,
    tab: TrackedTab,
    targetMemberKey?: string | null,
    position?: "before" | "after",
  ): void {
    const member = this.makeMemberFromTab(tab);
    this.addMemberToGroup(groupId, member, targetMemberKey, position);
  }

  public addMemberToGroup(
    groupId: string,
    member: VirtualGroupMember,
    targetMemberKey?: string | null,
    position?: "before" | "after",
  ): void {
    let changed = false;
    this.groups = this.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const existingIndex = group.members.findIndex(
        (item) => item.key === member.key,
      );
      if (targetMemberKey && position) {
        const members = [...group.members];
        const nextMember =
          existingIndex >= 0
            ? {
                ...members[existingIndex],
                ...member,
                id: members[existingIndex].id,
              }
            : { ...member, id: this.makeID("member") };
        if (existingIndex >= 0) {
          members.splice(existingIndex, 1);
        }

        const targetIndex = members.findIndex(
          (item) => item.key === targetMemberKey,
        );
        if (targetIndex < 0) {
          return group;
        }

        changed = true;
        const insertIndex = Math.max(
          0,
          Math.min(
            targetIndex + (position === "after" ? 1 : 0),
            members.length,
          ),
        );
        members.splice(insertIndex, 0, nextMember);
        return {
          ...group,
          members,
        };
      }

      if (existingIndex >= 0) {
        changed = true;
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

      changed = true;
      return {
        ...group,
        members: [...group.members, { ...member, id: this.makeID("member") }],
      };
    });

    if (changed) {
      this.emit();
    }
  }

  public moveMemberToGroup(
    sourceGroupId: string,
    targetGroupId: string,
    memberKey: string,
    targetMemberKey?: string | null,
    position?: "before" | "after",
  ): void {
    if (
      !sourceGroupId ||
      !targetGroupId ||
      !memberKey ||
      sourceGroupId === targetGroupId
    ) {
      return;
    }

    const sourceGroup = this.groups.find((group) => group.id === sourceGroupId);
    const member =
      sourceGroup?.members.find((item) => item.key === memberKey) ?? null;
    const targetGroup = this.groups.find((group) => group.id === targetGroupId);
    if (!member || !targetGroup) {
      return;
    }
    if (
      targetMemberKey &&
      position &&
      (targetMemberKey === memberKey ||
        !targetGroup.members.some((item) => item.key === targetMemberKey))
    ) {
      return;
    }

    let changed = false;
    this.groups = this.groups
      .map((group) => {
        if (group.id === sourceGroupId) {
          const members = group.members.filter((item) => item.key !== memberKey);
          if (members.length !== group.members.length) {
            changed = true;
          }
          return {
            ...group,
            members,
          };
        }

        if (group.id === targetGroupId) {
          const existingIndex = group.members.findIndex(
            (item) => item.key === member.key,
          );
          const members = [...group.members];
          if (targetMemberKey && position) {
            const nextMember =
              existingIndex >= 0
                ? {
                    ...members[existingIndex],
                    ...member,
                    id: members[existingIndex].id,
                  }
                : { ...member, id: this.makeID("member") };
            if (existingIndex >= 0) {
              members.splice(existingIndex, 1);
            }

            const targetIndex = members.findIndex(
              (item) => item.key === targetMemberKey,
            );
            if (targetIndex < 0) {
              return group;
            }

            const insertIndex = Math.max(
              0,
              Math.min(
                targetIndex + (position === "after" ? 1 : 0),
                members.length,
              ),
            );
            members.splice(insertIndex, 0, nextMember);
            changed = true;
            return {
              ...group,
              members,
            };
          }

          if (existingIndex >= 0) {
            members[existingIndex] = {
              ...members[existingIndex],
              ...member,
              id: members[existingIndex].id,
            };
          } else {
            members.push({ ...member, id: this.makeID("member") });
          }
          changed = true;
          return {
            ...group,
            members,
          };
        }

        return group;
      })
      .filter((group) => group.members.length > 0);

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

  public containsTab(groupId: string, tab: TrackedTab): boolean {
    const group = this.groups.find((item) => item.id === groupId);
    if (!group) {
      return false;
    }

    const tabLookupKeys = new Set(this.getMemberLookupKeysFromTab(tab));
    return group.members.some((member) =>
      this.getMemberLookupKeysFromMember(member).some((key) =>
        tabLookupKeys.has(key),
      ),
    );
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

  public expandGroupsContainingTab(tab: TrackedTab): boolean {
    const tabLookupKeys = new Set(this.getMemberLookupKeysFromTab(tab));
    let changed = false;
    this.groups = this.groups.map((group) => {
      if (
        !group.collapsed ||
        !group.members.some((member) =>
          this.getMemberLookupKeysFromMember(member).some((key) =>
            tabLookupKeys.has(key),
          ),
        )
      ) {
        return group;
      }

      changed = true;
      return {
        ...group,
        collapsed: false,
      };
    });

    if (changed) {
      this.emit();
    }
    return changed;
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
    const groupedMemberKeys = new Set<string>();
    this.groups.forEach((group) => {
      group.members.forEach((member) => {
        this.getMemberLookupKeysFromMember(member).forEach((key) => {
          groupedMemberKeys.add(key);
        });
      });
    });

    return tabs.filter(
      (tab) =>
        !this.getMemberLookupKeysFromTab(tab).some((key) =>
          groupedMemberKeys.has(key),
        ),
    );
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

  private getMemberLookupKeysFromMember(
    member: VirtualGroupMember,
  ): string[] {
    return makeVirtualMemberLookupKeys({
      itemID: member.itemID,
      parentItemID: member.parentItemID,
      tabId: member.tabId,
      type: member.type,
      title: member.title,
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
      a.openedAt === b.openedAt &&
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
