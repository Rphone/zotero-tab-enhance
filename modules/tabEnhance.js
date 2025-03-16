(function() {
  // Avoid duplicate declarations
  if (typeof Zotero.TabEnhance !== "undefined") {
    return;
  }

  class TabEnhanceModule {
    constructor(window) {
      this.window = window;
      this.document = window.document;
      this.initialized = false;
      this._handleContextMenu = this._handleContextMenu.bind(this);
    }

    init() {
      if (this.initialized) return;

      // Add right-click event listener
      this._addTabContextMenuListener();
      this.initialized = true;
      // Zotero.debug("TabEnhance: Initialization complete");
    }

    _addTabContextMenuListener() {
      let lastClickedTabInfo = null;

      this._handleContextMenuEvent = (event) => {
        // Zotero.debug("TabEnhance: Tab right-clicked");
        lastClickedTabInfo = this._extractTabInfo(event);
        // Zotero.debug(
        //   `TabEnhance: Tab clicked - ${lastClickedTabInfo?.tabId || "unidentified"}`
        // );
      };

      this.handlepopupshowingEvent = (event) => {
        // Zotero.debug("TabEnhance: Menu popup");
        if (lastClickedTabInfo) {
          this._handleContextMenu(event.target, lastClickedTabInfo);
        }
        lastClickedTabInfo = null;
      };

      // Find containers that might contain tabs
      const tabContainers = [
        this.document.querySelector(".pinned-tabs .tabs"),
        this.document.querySelector(".tabs-wrapper .tabs"),
      ].filter((container) => container !== null);

      for (const container of tabContainers) {
        if (container) {
          container.addEventListener("contextmenu", this._handleContextMenuEvent);
        }
      }
      this.document.addEventListener(
        "popupshowing",
        this.handlepopupshowingEvent
      );

      // Zotero.debug("TabEnhance: Added listeners to tab containers");
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

      // Zotero.debug(
      //   `TabEnhance: Detected tab right-click - ID: ${tabId}, Title: ${tabTitle}, Selected: ${isSelected}`
      // );

      const menupopup = element;

      // Check if menu item already exists
      const existingMenuItems = menupopup.querySelectorAll("menuitem");
      for (const menuItem of existingMenuItems) {
        if (menuItem.getAttribute("id") === "tabEnhance-show-in-filesystem") {
          // Zotero.debug("TabEnhance: Menu item already exists");
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
    }

    async _showInFilesystem(tabId) {
      try {
        let { tab } = this.window.Zotero_Tabs._getTab(tabId);
        if (!tab || (tab.type !== "reader" && tab.type !== "reader-unloaded")) {
          // Zotero.debug("TabEnhance: Invalid tab");
          return;
        }

        let itemID = tab.data.itemID;
        let item = Zotero.Items.get(itemID);
        // Zotero.debug(
        //   `TabEnhance: Processing tab item - ID: ${itemID}, Type: ${
        //     item ? item.itemType : "unknown"
        //   }`
        // );
        
        let attachment = item.isFileAttachment() ? item : item.getBestAttachment();
        if (!attachment) {
          // Zotero.debug("TabEnhance: No attachment found");
          return;
        }
        await this.window.ZoteroPane.showAttachmentInFilesystem(attachment.id);
        
      } catch (error) {
        // Zotero.debug(`TabEnhance: Error showing in filesystem - ${error.message}`);
      }
    }

    destroy() {
      if (!this.initialized) return;

      // Remove event listeners
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
      this.initialized = false;
      // Zotero.debug("TabEnhance: Destroyed");
    }
  }

  // Export module
  Zotero.TabEnhance = {
    _instances: new Map(),

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
    }
  };
})();
