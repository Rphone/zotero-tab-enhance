import { ZoteroToolkit } from "zotero-plugin-toolkit";
import { getString } from "../utils/locale";
import { get } from "http";
interface TabInfo {
  tabId: string | null;
  isSelected: boolean;
  tabTitle: string | null;
}

interface MenuItemConfig {
  id: string;
  label: string;
  handler: () => void;
}

const MENU_ITEM_IDS = {
  SHOW_IN_FILESYSTEM: "tabenhance-show-in-filesystem",
  RELOAD: "tabenhance-reload",
};

export default class TabEnhance {
  private window: Window;
  private document: Document;
  private initialized: boolean;
  private lastClickedTabInfo: TabInfo | null = null;
  private handleContextMenuEvent!: (event: Event) => void;
  private handlepopupshowingEvent!: (event: Event) => void;
  private ztoolkit: ZoteroToolkit = ztoolkit;

  constructor(window: Window) {
    this.window = window;
    if (!window.document) {
      throw new Error("Document is not available on the provided window.");
    }
    this.document = window.document;
    this.initialized = false;
  }

  public init(): void {
    if (this.initialized) return;
    this.registerEventHandlers();
    this.removeAllEventListeners();
    this.attachEventListeners();
    this.initialized = true;
    this.ztoolkit.log("TabEnhance module initialized successfully");
  }

  destroy() {
    if (!this.initialized) return;
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
      this.addExtraMenuItems(event.target, this.lastClickedTabInfo!);
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

  private addExtraMenuItems(element: EventTarget | null, tabInfo: TabInfo) {
    const menupopup = element as Element;
    if (this.menuItemsExist(menupopup)) return;

    this.createMenuItem(menupopup, {
      id: MENU_ITEM_IDS.SHOW_IN_FILESYSTEM,
      label: getString(MENU_ITEM_IDS.SHOW_IN_FILESYSTEM),
      handler: () => this.showInFilesystem(tabInfo.tabId),
    });

    this.createMenuItem(menupopup, {
      id: MENU_ITEM_IDS.RELOAD,
      label: getString(MENU_ITEM_IDS.RELOAD),
      handler: () => this.reloadTab(tabInfo.tabId),
    });
  }

  private menuItemsExist(menupopup: Element): boolean {
    return (
      menupopup.querySelector(`#${MENU_ITEM_IDS.SHOW_IN_FILESYSTEM}`) !== null
    );
  }

  private createMenuItem(element: Element, config: MenuItemConfig) {
    const menuItem = this.ztoolkit.createXULElement(this.document, "menuitem");
    menuItem.setAttribute("id", config.id);
    menuItem.setAttribute("label", config.label);
    menuItem.addEventListener("command", config.handler);
    element.appendChild(menuItem);
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

  // UI Helpers
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

  async showInFilesystem(tabId: string | null) {
    try {
      const { tab } = this.window.Zotero_Tabs._getTab(tabId);
      if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
        return;
      }

      const itemID = tab.data.itemID;
      const item = Zotero.Items.get(itemID);
      const attachment = item.isFileAttachment()
        ? item
        : await item.getBestAttachment();
      if (!attachment) {
        return;
      }
      await this.window.ZoteroPane.showAttachmentInFilesystem(attachment.id);
    } catch (error) {
      this.ztoolkit.log("Error showing in filesystem:", error);
    }
  }

  private async reloadTab(tabId: string | null) {
    try {
      const { tab } = this.window.Zotero_Tabs._getTab(tabId);
      if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
        return;
      }
      const { itemID, secondViewState } = tab.data;
      const item = Zotero.Items.get(itemID);
      this.window.Zotero_Tabs.close(tabId);
      await (Zotero as any).FileHandlers.open(item);
    } catch (error) {
      this.ztoolkit.log("Error reloading tab:", error);
    }
  }
}
