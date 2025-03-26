(function () {
  // Avoid duplicate declarations
  if (typeof Zotero.TabEnhance !== "undefined") {
    return;
  }

  // add debug flag
  const DEBUG_MODE = false;

  class TabEnhanceModule {
    constructor(window) {
      this.window = window;
      this.document = window.document;
      this.initialized = false;
      this._handleContextMenu = this._handleContextMenu.bind(this);
    }

    // Add log method to instance
    _log(message, level = "debug") {
      if (DEBUG_MODE || level === "error") {
        Zotero.debug(`TabEnhance: ${message}`);
      }
    }

    init() {
      if (this.initialized) return;

      // Add right-click event listener
      this.removeEventListeners();
      this._addTabContextMenuListener();
      this.initialized = true;
      this._log("Initialization complete");
    }

    _addTabContextMenuListener() {
      let lastClickedTabInfo = null;

      this._handleContextMenuEvent = (event) => {
        this._log("Tab right-clicked");
        lastClickedTabInfo = this._extractTabInfo(event);
        this._log(
          `Tab clicked - ${lastClickedTabInfo?.tabId || "unidentified"}`
        );
      };

      this.handlepopupshowingEvent = (event) => {
        this._log("Menu popup");
        if (lastClickedTabInfo) {
          this._handleContextMenu(event.target, lastClickedTabInfo);
        }
        lastClickedTabInfo = null;
      };

      // Find containers that might contain tabs
      const tabContainers = [
        this.document.querySelector(".tabs-wrapper .tabs"),
      ].filter((container) => container !== null);

      for (const container of tabContainers) {
        if (container) {
          container.addEventListener(
            "contextmenu",
            this._handleContextMenuEvent
          );
        }
      }
      this.document.addEventListener(
        "popupshowing",
        this.handlepopupshowingEvent
      );

      this._log("Added listeners to tab containers");
    }

    _extractTabInfo(event) {
      let tabElement = event.target;
      while (tabElement && !tabElement.classList.contains("tab")) {
        tabElement = tabElement.parentNode;
        if (!tabElement || tabElement === this.document) return null;
      }

      if (!tabElement) return null;

      const tabId = tabElement.getAttribute("data-id");

      if (tabId === null || tabId === "zotero-pane") return null;

      const isSelected = tabElement.classList.contains("selected");
      let tabTitle = "";

      const tabNameElement = tabElement.querySelector(".tab-name");
      if (tabNameElement) {
        tabTitle =
          tabNameElement.getAttribute("title") || tabNameElement.textContent;
      }

      return { tabId, isSelected, tabTitle };
    }

    _handleContextMenu(element, info) {
      const tabId = info.tabId;
      const isSelected = info.isSelected;
      const tabTitle = info.tabTitle;

      this._log(
        `Detected tab right-click - ID: ${tabId}, Title: ${tabTitle}, Selected: ${isSelected}`
      );

      const menupopup = element;

      // Check if menu item already exists
      const existingMenuItems = menupopup.querySelectorAll("menuitem");
      for (const menuItem of existingMenuItems) {
        if (menuItem.getAttribute("id") === "tabEnhance-show-in-filesystem") {
          this._log("Menu item already exists");
          return;
        }
      }
      // Create new menuitem
      const newMenuItem = this.document.createXULElement("menuitem");
      // Set menuitem attributes
      newMenuItem.setAttribute("label", "Show in Filesystem");
      newMenuItem.setAttribute("id", "tabEnhance-show-in-filesystem");
      // Add click event
      newMenuItem.addEventListener("command", () =>
        this._showInFilesystem(tabId)
      );
      // Append menuitem to menupopup
      menupopup.appendChild(newMenuItem);

      // add reload menu item
      const reloadMenuItem = this.document.createXULElement("menuitem");
      reloadMenuItem.setAttribute("label", "Reload");
      reloadMenuItem.setAttribute("id", "tabEnhance-reload");
      reloadMenuItem.addEventListener("command", () => 
        this._reloadTab(tabId)
      );
      menupopup.appendChild(reloadMenuItem);

    }
    async _reloadTab(tabId) {
      try{
        let { tab } = this.window.Zotero_Tabs._getTab(tabId);
        if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
          this._log("Invalid tab");
          return;
        }
        let { itemID, secondViewState } = tab.data;
        let item = Zotero.Items.get(itemID);
        this.window.Zotero_Tabs.close(tabId);
        await Zotero.FileHandlers.open(item);

      } catch (error) {
        this._log(`Error reloading tab - ${error.message}`,
        "error");
      }
    }
    async _showInFilesystem(tabId) {
      try {
        let { tab } = this.window.Zotero_Tabs._getTab(tabId);
        if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
          this._log("Invalid tab");
          return;
        }

        let itemID = tab.data.itemID;
        let item = Zotero.Items.get(itemID);
        this._log(
          `Processing tab item - ID: ${itemID}, Type: ${
            item ? item.itemType : "unknown"
          }`
        );

        let attachment = item.isFileAttachment()
          ? item
          : item.getBestAttachment();
        if (!attachment) {
          this._log("No attachment found");
          return;
        }
        await this.window.ZoteroPane.showAttachmentInFilesystem(attachment.id);
      } catch (error) {
        this._log(`Error showing in filesystem - ${error.message}`, "error");
      }
    }

    destroy() {
      if (!this.initialized) return;
      // Remove event listeners
      this.removeEventListeners();
      this.initialized = false;
      this._log("Destroyed");
    }

    removeEventListeners() {
      const tabContainers = [
        this.document.querySelector(".tabs-wrapper .tabs"),
      ].filter((container) => container !== null);

      for (const container of tabContainers) {
        if (container) {
          container.removeEventListener(
            "contextmenu",
            this._handleContextMenuEvent
          );
        }
      }
      this.document.removeEventListener(
        "popupshowing",
        this.handlepopupshowingEvent
      );
    }
  }

  // Export module
  Zotero.TabEnhance = {
    _instances: new Map(),
    DEBUG_MODE: DEBUG_MODE, 

    // Add log method to module
    log(message, level = "debug") {
      if (this.DEBUG_MODE || level === "error") {
        Zotero.debug(`TabEnhance: ${message}`);
      }
    },

    init(window) {
      if (!window || this._instances.has(window)) return;

      const instance = new TabEnhanceModule(window);
      this._instances.set(window, instance);
      instance.init();
    },

    destroy(window) {
      if (!window) {
        // Destroy all instances
        for (const [win, instance] of this._instances.entries()) {
          instance.destroy();
        }
        this._instances.clear();
      } else if (this._instances.has(window)) {
        // Destroy instance for specific window
        this._instances.get(window).destroy();
        this._instances.delete(window);
      }
    },

    // Add unload method
    unload() {
      this.destroy();
    },
  };
})();
