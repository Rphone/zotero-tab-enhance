import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { getString } from "../utils/locale";
import TabCommandController from "./verticalTabs/tabCommands";
import { getPref } from "../utils/prefs";

interface TabInfo {
  tabId: string | null;
  isSelected: boolean;
  tabTitle: string | null;
}

interface MenuItemConfig {
  id: string;
  label: string;
  handler: () => Promise<void> | void;
  disabled?: boolean;
}

interface GroupMenuItemConfig {
  id: string;
  name: string;
  color: string;
}

const MENU_ITEM_IDS = {
  SHOW_IN_FILESYSTEM: "show-in-filesystem",
  RELOAD: "reload",
  COPY_REFERENCE: "copy-to-clipboard",
} as const;

export default class TabEnhance {
  private window: _ZoteroTypes.MainWindow;
  private document: Document;
  private initialized: boolean;
  private lastClickedTabInfo: TabInfo | null = null;
  private handleContextMenuEvent!: (event: Event) => void;
  private handlepopupshowingEvent!: (event: Event) => void;
  private ztoolkit: ZoteroToolkit = ztoolkit;
  private availableMenuItems: MenuItemConfig[] = [];
  private commandController: TabCommandController;

  constructor(window: _ZoteroTypes.MainWindow) {
    this.window = window;
    if (!window.document) {
      throw new Error("Document is not available on the provided window.");
    }
    this.document = window.document;
    this.initialized = false;
    this.commandController = new TabCommandController(window);
  }

  public init(): void {
    if (this.initialized) {
      this.ztoolkit.log("TabEnhance module already initialized, skipping");
      return;
    }
    this.registerEventHandlers();
    this.removeAllEventListeners();
    this.attachEventListeners();
    this.initialized = true;
    this.ztoolkit.log("TabEnhance module initialized successfully");
  }

  destroy() {
    if (!this.initialized) {
      this.ztoolkit.log("TabEnhance module not initialized, skipping destroy");
      return;
    }
    this.removeAllEventListeners();
    this.initialized = false;
    this.ztoolkit.log("TabEnhance module destroyed successfully");
  }

  private registerEventHandlers() {
    this.handleContextMenuEvent = (event: Event) => {
      this.lastClickedTabInfo = this.getSelectedTabInfo(event.target);
    };

    this.handlepopupshowingEvent = (event: Event) => {
      if (!this.lastClickedTabInfo) return;
      this.addExtraMenuItems(event.target, this.lastClickedTabInfo);
      this.lastClickedTabInfo = null;
    };
  }

  private getSelectedTabInfo(element: EventTarget | null): TabInfo | null {
    if (!element) return null;
    let tabElement = element as Element;
    while (tabElement && !tabElement.classList.contains("tab")) {
      if (!tabElement.parentNode) return null;
      tabElement = tabElement.parentNode as Element;
    }
    if (!tabElement) return null;

    const tabId = tabElement.getAttribute("data-id");

    if (tabId === null || tabId === "zotero-pane") return null;

    const isSelected = tabElement.classList.contains("selected");
    let tabTitle: string | null = null;

    const tabNameElement = tabElement.querySelector(".tab-name");
    if (tabNameElement) {
      tabTitle =
        tabNameElement.getAttribute("title") || tabNameElement.textContent;
    }

    return { tabId, isSelected, tabTitle };
  }

  private updateAvailableMenuItems(tabInfo: TabInfo) {
    this.availableMenuItems = [];
    const items = this.commandController.getContextMenuItems(tabInfo.tabId);

    items.forEach((item) => {
      if (
        item.id === MENU_ITEM_IDS.COPY_REFERENCE &&
        !getPref("enableCopyReference")
      ) {
        return;
      }
      if (
        item.id === MENU_ITEM_IDS.SHOW_IN_FILESYSTEM &&
        !getPref("enableGoToAttachment")
      ) {
        return;
      }
      if (item.id === MENU_ITEM_IDS.RELOAD && !getPref("enableReloadTab")) {
        return;
      }
      if (item.id === "close") {
        return;
      }
      this.availableMenuItems.push(item);
    });
  }

  private addExtraMenuItems(element: EventTarget | null, tabInfo: TabInfo) {
    const menupopup = element as Element;

    this.updateAvailableMenuItems(tabInfo);
    const groups = this.getAvailableGroups();
    const sidebar = addon.verticalTabSidebarInstances.get(this.window);

    if (!sidebar && this.availableMenuItems.length === 0 && groups.length === 0)
      return;

    menupopup.appendChild(
      this.ztoolkit.createXULElement(this.document, "menuseparator"),
    );

    this.availableMenuItems.forEach((config) => {
      this.addMenuItemToPopup(menupopup, config);
    });

    if (sidebar) {
      this.addMenuItemToPopup(menupopup, {
        id: "create-group",
        label: getString("create-group"),
        handler: () => {
          const groupName = this.window.prompt(
            getString("group-name-prompt"),
            tabInfo.tabTitle ?? getString("new-group"),
          );
          if (groupName === null) {
            return;
          }
          sidebar.createGroupFromOpenTab(
            tabInfo.tabId,
            groupName.trim() || getString("new-group"),
          );
        },
      });
    }

    if (groups.length > 0) {
      this.addGroupSubmenuToPopup(menupopup, tabInfo, groups);
    }
  }

  private addMenuItemToPopup(element: Element, config: MenuItemConfig) {
    const menuItem = this.ztoolkit.createXULElement(this.document, "menuitem");
    menuItem.setAttribute("id", config.id);
    menuItem.setAttribute("label", config.label);
    if (config.disabled) {
      menuItem.setAttribute("disabled", "true");
    }
    menuItem.addEventListener("command", () => void config.handler());
    element.appendChild(menuItem);
  }

  private addGroupSubmenuToPopup(
    element: Element,
    tabInfo: TabInfo,
    groups: GroupMenuItemConfig[],
  ) {
    const menu = this.ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute("label", getString("add-to-group"));

    const popup = this.ztoolkit.createXULElement(this.document, "menupopup");
    groups.forEach((group) => {
      const menuItem = this.ztoolkit.createXULElement(
        this.document,
        "menuitem",
      );
      menuItem.setAttribute("label", group.name);
      menuItem.setAttribute("style", `color:${group.color};`);
      menuItem.addEventListener("command", () => {
        const sidebar = addon.verticalTabSidebarInstances.get(this.window);
        sidebar?.addOpenTabToGroup(tabInfo.tabId, group.id);
      });
      popup.appendChild(menuItem);
    });

    menu.appendChild(popup);
    element.appendChild(menu);
  }

  private getAvailableGroups(): GroupMenuItemConfig[] {
    const sidebar = addon.verticalTabSidebarInstances.get(this.window);
    if (!sidebar) {
      return [];
    }

    return sidebar.getGroupsForContextMenu().map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
    }));
  }

  private removeAllEventListeners() {
    const tabContainers = this.getTabContainers();
    tabContainers.forEach((container) => {
      container.removeEventListener("contextmenu", this.handleContextMenuEvent);
    });

    this.document.removeEventListener(
      "popupshowing",
      this.handlepopupshowingEvent,
    );
  }

  private getTabContainers(): Element[] {
    return [this.document.querySelector(".tabs-wrapper .tabs")].filter(
      (container) => container !== null,
    );
  }

  private attachEventListeners() {
    const tabContainers = this.getTabContainers();
    tabContainers.forEach((container) => {
      container.addEventListener("contextmenu", this.handleContextMenuEvent);
    });

    this.document.addEventListener(
      "popupshowing",
      this.handlepopupshowingEvent,
    );
  }
}
