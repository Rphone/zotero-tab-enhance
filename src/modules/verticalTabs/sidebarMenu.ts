import { getString } from "../../utils/locale";
import { getGroupColorPalette } from "../../utils/prefs";
import TabGroupStore from "./groupStore";
import TabCommandController, { TabCommandItem } from "./tabCommands";
import { ContextMenuTarget } from "./sidebarCommon";
import { TrackedTab, VirtualGroup, VirtualGroupMember } from "./types";

type SidebarMenuActions = {
  beginCreateGroupEditor: (tab: TrackedTab) => void;
  beginRenameGroupEditor: (groupId: string) => void;
  openGroupMembers: (
    groupId: string,
    options?: { closeOthers?: boolean },
  ) => Promise<void>;
  closeGroupMembers: (groupId: string) => void;
};

type SidebarMenuLookups = {
  getTrackedTabByKey: (tabKey: string) => TrackedTab | null;
  getTrackedTabByMemberKey: (memberKey: string) => TrackedTab | null;
};

export default class SidebarMenuController {
  constructor(
    private readonly document: Document,
    private readonly commandController: TabCommandController,
    private readonly groupStore: TabGroupStore,
    private readonly lookups: SidebarMenuLookups,
    private readonly actions: SidebarMenuActions,
  ) {}

  public showContextMenu(
    contextMenu: XULPopupElement | undefined,
    target: ContextMenuTarget,
    screenX: number,
    screenY: number,
  ): void {
    if (!contextMenu) {
      return;
    }
    this.hideContextMenu(contextMenu);

    switch (target.kind) {
      case "tab":
        this.populateTabContextMenu(contextMenu, target.tabKey);
        break;
      case "group-header":
        this.populateGroupHeaderContextMenu(contextMenu, target.groupId);
        break;
      case "group-member":
        this.populateGroupMemberContextMenu(
          contextMenu,
          target.groupId,
          target.memberKey,
        );
        break;
    }

    if (!contextMenu.firstChild) {
      return;
    }

    contextMenu.openPopupAtScreen(screenX, screenY, true);
  }

  public hideContextMenu(contextMenu: XULPopupElement | undefined): void {
    if (!contextMenu) {
      return;
    }

    contextMenu.hidePopup();
    while (contextMenu.firstChild) {
      contextMenu.removeChild(contextMenu.firstChild);
    }
  }

  private populateTabContextMenu(
    contextMenu: XULPopupElement,
    tabKey: string,
  ): void {
    const tracked = this.lookups.getTrackedTabByKey(tabKey);
    if (!tracked) {
      return;
    }

    this.commandController
      .getContextMenuItems(tracked.tabId)
      .forEach((item) =>
        contextMenu.appendChild(this.renderContextMenuItem(contextMenu, item)),
      );

    this.appendSeparator(contextMenu);
    this.appendMenuItem(contextMenu, getString("create-group"), () => {
      this.actions.beginCreateGroupEditor(tracked);
    });

    const groups = this.groupStore.getGroups();
    if (groups.length > 0) {
      this.appendGroupSubmenu(
        contextMenu,
        getString("add-to-group"),
        groups,
        (group) => () => this.groupStore.addTabToGroup(group.id, tracked),
      );
    }
  }

  private populateGroupMemberContextMenu(
    contextMenu: XULPopupElement,
    groupId: string,
    memberKey: string,
  ): void {
    const group = this.groupStore.findGroupById(groupId);
    const member =
      group?.members.find((item) => item.key === memberKey) ?? null;
    if (!group || !member) {
      return;
    }

    const liveTab = this.lookups.getTrackedTabByMemberKey(member.key);
    if (liveTab) {
      this.commandController
        .getContextMenuItems(liveTab.tabId)
        .forEach((item) =>
          contextMenu.appendChild(
            this.renderContextMenuItem(contextMenu, item),
          ),
        );
      this.appendSeparator(contextMenu);
    } else {
      this.commandController
        .getVirtualMemberContextMenuItems(member)
        .forEach((item) =>
          contextMenu.appendChild(
            this.renderContextMenuItem(contextMenu, item),
          ),
        );
      if (contextMenu.firstChild) {
        this.appendSeparator(contextMenu);
      }
    }

    const otherGroups = this.groupStore
      .getGroups()
      .filter((item) => item.id !== group.id);
    if (otherGroups.length > 0) {
      this.appendGroupSubmenu(
        contextMenu,
        getString("move-to-group"),
        otherGroups,
        (targetGroup) => () =>
          this.groupStore.moveMemberToGroup(group.id, targetGroup.id, member.key),
      );
      this.appendGroupSubmenu(
        contextMenu,
        getString("add-to-group"),
        otherGroups,
        (targetGroup) => () =>
          this.groupStore.addMemberToGroup(targetGroup.id, member),
      );
      this.appendSeparator(contextMenu);
    }

    this.appendMenuItem(contextMenu, getString("remove-from-group"), () => {
      this.groupStore.removeMember(group.id, member.key);
    });
  }

  private populateGroupHeaderContextMenu(
    contextMenu: XULPopupElement,
    groupId: string,
  ): void {
    const group = this.groupStore.findGroupById(groupId);
    if (!group) {
      return;
    }

    this.appendMenuItem(contextMenu, getString("open-group-all"), async () => {
      await this.actions.openGroupMembers(group.id);
    });
    this.appendMenuItem(contextMenu, getString("open-group-only"), async () => {
      await this.actions.openGroupMembers(group.id, { closeOthers: true });
    });
    this.appendMenuItem(contextMenu, getString("close-group-all"), () => {
      this.actions.closeGroupMembers(group.id);
    });
    this.appendSeparator(contextMenu);
    this.appendMenuItem(
      contextMenu,
      group.collapsed ? getString("expand-group") : getString("collapse-group"),
      () => this.groupStore.toggleCollapsed(group.id),
    );
    this.appendMenuItem(contextMenu, getString("rename-group"), () => {
      this.actions.beginRenameGroupEditor(group.id);
    });
    this.appendColorSubmenu(contextMenu, group.id, group.color);
    this.appendSeparator(contextMenu);
    this.appendMenuItem(contextMenu, getString("dissolve-group"), () => {
      this.groupStore.dissolveGroup(group.id);
    });
  }

  private renderContextMenuItem(
    contextMenu: XULPopupElement,
    item: TabCommandItem,
  ): XULElement {
    return this.createMenuItem(
      contextMenu,
      item.label,
      async () => {
        this.hideContextMenu(contextMenu);
        if (item.disabled) {
          return;
        }
        await item.handler();
      },
      Boolean(item.disabled),
    );
  }

  private appendMenuItem(
    contextMenu: XULPopupElement,
    label: string,
    handler: () => void | Promise<void>,
    disabled = false,
  ): void {
    contextMenu.appendChild(
      this.createMenuItem(contextMenu, label, handler, disabled),
    );
  }

  private appendSeparator(contextMenu: XULPopupElement): void {
    if (!contextMenu.firstChild) {
      return;
    }

    contextMenu.appendChild(
      ztoolkit.createXULElement(this.document, "menuseparator"),
    );
  }

  private appendGroupSubmenu(
    contextMenu: XULPopupElement,
    label: string,
    groups: VirtualGroup[],
    handlerFactory: (group: VirtualGroup) => () => void,
  ): void {
    if (groups.length === 0) {
      return;
    }

    const menu = ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute("label", label);
    const popup = ztoolkit.createXULElement(this.document, "menupopup");

    groups.forEach((group) => {
      popup.appendChild(
        this.createMenuItem(
          contextMenu,
          group.name,
          handlerFactory(group),
          false,
          group.color,
        ),
      );
    });

    menu.appendChild(popup);
    contextMenu.appendChild(menu);
  }

  private appendColorSubmenu(
    contextMenu: XULPopupElement,
    groupId: string,
    currentColor: string,
  ): void {
    const menu = ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute("label", getString("change-group-color"));
    const popup = ztoolkit.createXULElement(this.document, "menupopup");

    const palette = getGroupColorPalette();
    palette.forEach((color, index) => {
      popup.appendChild(
        this.createMenuItem(
          contextMenu,
          `${getString("group-color")} ${index + 1}`,
          () => this.groupStore.setColor(groupId, color),
          color === currentColor,
          color,
        ),
      );
    });

    menu.appendChild(popup);
    contextMenu.appendChild(menu);
  }

  private createMenuItem(
    contextMenu: XULPopupElement,
    label: string,
    handler: () => void | Promise<void>,
    disabled = false,
    color?: string,
  ): XULElement {
    const menuItem = ztoolkit.createXULElement(this.document, "menuitem");
    menuItem.setAttribute("label", label);
    menuItem.addEventListener("command", async () => {
      this.hideContextMenu(contextMenu);
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
}
