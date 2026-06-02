import { getString } from "../utils/locale";
import VerticalTabSidebar from "./verticalTabs/sidebar";

export default class ItemMenuEnhance {
  private readonly window: _ZoteroTypes.MainWindow;
  private readonly document: Document;
  private readonly getSidebar: () => VerticalTabSidebar | null;
  private menu?: XULElement;
  private popup?: XULPopupElement;
  private itemMenu?: XULPopupElement;
  private initialized = false;

  constructor(
    window: _ZoteroTypes.MainWindow,
    getSidebar: () => VerticalTabSidebar | null,
  ) {
    this.window = window;
    this.document = window.document;
    this.getSidebar = getSidebar;
  }

  public init(): boolean {
    if (this.initialized) {
      return true;
    }

    const itemMenu = this.document.querySelector(
      "#zotero-itemmenu",
    ) as XULPopupElement | null;
    if (!itemMenu) {
      ztoolkit.log("ItemMenuEnhance skipped missing zotero item menu");
      return false;
    }

    const menu = ztoolkit.createXULElement(this.document, "menu");
    menu.setAttribute(
      "id",
      `${addon.data.config.addonRef}-item-menu-open-group`,
    );
    menu.setAttribute("label", getString("item-menu-open-and-group"));
    menu.setAttribute("class", "menu-iconic");
    menu.setAttribute(
      "image",
      `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`,
    );

    const popup = ztoolkit.createXULElement(this.document, "menupopup");
    popup.setAttribute(
      "id",
      `${addon.data.config.addonRef}-item-menu-open-group-popup`,
    );
    popup.addEventListener("popupshowing", this.handleSubmenuShowing);
    menu.appendChild(popup);

    itemMenu.appendChild(menu);
    itemMenu.addEventListener("popupshowing", this.handleItemMenuShowing);

    this.itemMenu = itemMenu;
    this.menu = menu;
    this.popup = popup as XULPopupElement;
    this.initialized = true;
    return true;
  }

  public destroy(): void {
    if (!this.initialized) {
      return;
    }

    this.itemMenu?.removeEventListener(
      "popupshowing",
      this.handleItemMenuShowing,
    );
    this.popup?.removeEventListener("popupshowing", this.handleSubmenuShowing);
    this.menu?.remove();
    this.clearPopup();
    this.itemMenu = undefined;
    this.menu = undefined;
    this.popup = undefined;
    this.initialized = false;
  }

  private readonly handleItemMenuShowing = () => {
    const disabled = !this.getSidebar() || this.getSelectedItems().length === 0;
    this.menu?.toggleAttribute("disabled", disabled);
  };

  private readonly handleSubmenuShowing = () => {
    this.populateSubmenu();
  };

  private populateSubmenu(): void {
    if (!this.popup) {
      return;
    }

    this.clearPopup();

    const selectedItems = this.getSelectedItems();
    const sidebar = this.getSidebar();
    if (!sidebar || !selectedItems.length) {
      this.popup.appendChild(
        this.createMenuItem(getString("item-menu-no-selected-items"), () => {
          // No-op placeholder to explain disabled state in the submenu.
        }, true),
      );
      return;
    }

    this.popup.appendChild(
      this.createMenuItem(getString("item-menu-open-in-new-group"), async () => {
        await sidebar.openItemsInNewGroup(this.getSelectedItems());
      }),
    );

    const groups = sidebar.getGroupsForContextMenu();
    if (!groups.length) {
      return;
    }

    this.popup.appendChild(
      ztoolkit.createXULElement(this.document, "menuseparator"),
    );
    groups.forEach((group) => {
      this.popup?.appendChild(
        this.createMenuItem(group.name, async () => {
          await sidebar.openItemsIntoGroup(this.getSelectedItems(), group.id);
        }),
      );
    });
  }

  private createMenuItem(
    label: string,
    handler: () => void | Promise<void>,
    disabled = false,
  ): XULElement {
    const menuItem = ztoolkit.createXULElement(this.document, "menuitem");
    menuItem.setAttribute("label", label);
    if (disabled) {
      menuItem.setAttribute("disabled", "true");
    }
    menuItem.addEventListener("command", async () => {
      if (disabled) {
        return;
      }
      await handler();
    });
    return menuItem;
  }

  private clearPopup(): void {
    while (this.popup?.firstChild) {
      this.popup.removeChild(this.popup.firstChild);
    }
  }

  private getSelectedItems(): any[] {
    try {
      const selectedItems = this.window.ZoteroPane.getSelectedItems?.();
      return Array.isArray(selectedItems) ? selectedItems : [];
    } catch (error) {
      ztoolkit.log("ItemMenuEnhance failed to read selected items", error);
      return [];
    }
  }
}
