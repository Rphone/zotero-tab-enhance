import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { SidebarElements, SidebarViewMode } from "./sidebarCommon";

type MountSidebarLayoutOptions = {
  window: _ZoteroTypes.MainWindow;
  document: Document;
  onToggleCollapsed: () => void;
  onCreateGroupFromSelectedTab: () => void;
  onSearchInput: (value: string) => void;
  onViewModeChange: (mode: SidebarViewMode) => void;
  onListDragOver: (event: DragEvent) => void;
  onListDrop: (event: DragEvent) => void;
  onResizeStart: () => void;
};

export function mountSidebarLayout(
  options: MountSidebarLayoutOptions,
): SidebarElements | null {
  const deck = options.window.Zotero_Tabs.deck as unknown as XULElement | null;
  const deckParent = deck?.parentNode;
  if (!deck || !deckParent) {
    return null;
  }

  const stylesheet = ensureStylesheet(options.document);

  const sidebar = ztoolkit.UI.createElement(options.document, "vbox", {
    classList: ["tab-enhance-vertical-tabs-sidebar"],
    attributes: {
      id: `${config.addonRef}-vertical-tabs-sidebar`,
    },
  }) as XULElement;

  const header = ztoolkit.UI.createElement(options.document, "hbox", {
    classList: ["tab-enhance-vertical-tabs-header"],
  }) as XULElement;

  const toggleButton = ztoolkit.UI.createElement(
    options.document,
    "toolbarbutton",
    {
      classList: ["tab-enhance-vertical-tabs-toggle"],
      attributes: {
        label: "<",
        tooltiptext: "Toggle vertical tabs sidebar",
      },
      listeners: [
        {
          type: "command",
          listener: options.onToggleCollapsed,
        },
      ],
    },
  ) as XULElement;

  const headerTitle = ztoolkit.UI.createElement(options.document, "div", {
    namespace: "html",
    classList: ["tab-enhance-vertical-tabs-title"],
    properties: {
      textContent: "Tabs",
    },
  }) as HTMLDivElement;

  const countBadge = ztoolkit.UI.createElement(options.document, "div", {
    namespace: "html",
    classList: ["tab-enhance-vertical-tabs-count"],
    properties: {
      textContent: "0",
    },
  }) as HTMLDivElement;

  const createGroupButton = ztoolkit.UI.createElement(
    options.document,
    "button",
    {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-create-group"],
      properties: {
        textContent: "+",
        title: getString("create-group-from-selection"),
      },
      listeners: [
        {
          type: "click",
          listener: (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onCreateGroupFromSelectedTab();
          },
        },
      ],
    },
  ) as HTMLButtonElement;

  const searchInput = ztoolkit.UI.createElement(options.document, "input", {
    namespace: "html",
    classList: ["tab-enhance-vertical-tabs-search"],
    attributes: {
      type: "search",
      placeholder: getString("search-tabs"),
    },
    listeners: [
      {
        type: "input",
        listener: (event: Event) => {
          const target = event.currentTarget as HTMLInputElement | null;
          options.onSearchInput(target?.value ?? "");
        },
      },
    ],
  }) as HTMLInputElement;

  const viewSwitcher = ztoolkit.UI.createElement(options.document, "div", {
    namespace: "html",
    classList: ["tab-enhance-vertical-tabs-view-switcher"],
  }) as HTMLDivElement;

  (
    [
      ["default", getString("view-default")],
      ["recent", getString("view-recent")],
      ["type", getString("view-type")],
    ] as const
  ).forEach(([mode, label]) => {
    const button = ztoolkit.UI.createElement(options.document, "button", {
      namespace: "html",
      classList: ["tab-enhance-vertical-tabs-view-button"],
      properties: {
        textContent: label,
        title: label,
      },
      attributes: {
        type: "button",
        "data-view-mode": mode,
      },
      listeners: [
        {
          type: "click",
          listener: (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onViewModeChange(mode);
          },
        },
      ],
    }) as HTMLButtonElement;
    viewSwitcher.appendChild(button);
  });

  const listContainer = ztoolkit.UI.createElement(options.document, "div", {
    namespace: "html",
    classList: ["tab-enhance-vertical-tabs-list"],
    attributes: {
      role: "listbox",
    },
    listeners: [
      {
        type: "dragover",
        listener: options.onListDragOver,
      },
      {
        type: "drop",
        listener: options.onListDrop,
      },
    ],
  }) as HTMLDivElement;

  const contextMenu = ztoolkit.UI.createElement(options.document, "menupopup", {
    classList: ["tab-enhance-vertical-tabs-context-menu"],
    attributes: {
      id: `${config.addonRef}-vertical-tabs-context-menu`,
    },
  }) as unknown as XULPopupElement;

  header.appendChild(toggleButton);
  header.appendChild(headerTitle);
  header.appendChild(countBadge);
  header.appendChild(createGroupButton);
  sidebar.appendChild(header);
  sidebar.appendChild(searchInput);
  sidebar.appendChild(viewSwitcher);
  sidebar.appendChild(listContainer);

  const popupHost =
    options.document.getElementById("mainPopupSet") ??
    options.document.documentElement;
  popupHost?.appendChild(contextMenu);

  const splitter = ztoolkit.UI.createElement(options.document, "splitter", {
    classList: ["tab-enhance-vertical-tabs-splitter"],
    attributes: {
      id: `${config.addonRef}-vertical-tabs-splitter`,
    },
    listeners: [
      {
        type: "mousedown",
        listener: options.onResizeStart,
      },
    ],
  }) as XULElement;

  deckParent.insertBefore(splitter, deck);
  deckParent.insertBefore(sidebar, splitter);

  return {
    sidebar,
    splitter,
    toggleButton,
    createGroupButton,
    viewSwitcher,
    headerTitle,
    countBadge,
    listContainer,
    searchInput,
    contextMenu,
    stylesheet,
  };
}

export function removeSidebarLayout(elements: Partial<SidebarElements>): void {
  elements.sidebar?.remove();
  elements.splitter?.remove();
  elements.contextMenu?.remove();
  elements.stylesheet?.remove();
}

function ensureStylesheet(document: Document): HTMLElement {
  const stylesheetId = `${config.addonRef}-vertical-tabs-style`;
  const existing = document.getElementById(stylesheetId) as HTMLElement | null;
  if (existing) {
    return existing;
  }

  const link = ztoolkit.UI.createElement(document, "link", {
    namespace: "html",
    attributes: {
      id: stylesheetId,
      rel: "stylesheet",
      type: "text/css",
      href: `chrome://${config.addonRef}/content/zoteroPane.css`,
    },
  }) as HTMLElement;
  document.documentElement?.appendChild(link);
  return link;
}
