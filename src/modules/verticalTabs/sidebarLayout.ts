import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { SidebarElements, SidebarViewMode } from "./sidebarCommon";

type ZoteroColorScheme = "auto" | "light" | "dark";

const ZOTERO_COLOR_SCHEME_PREF = "browser.theme.toolbar-theme";

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
  const deckParentElement = deck?.parentElement;
  if (!deck || !deckParent || !deckParentElement) {
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
  syncSidebarThemeClass(
    options.window,
    options.document,
    sidebar,
    deckParentElement,
  );
  const themeCleanup = watchSidebarTheme(
    options.window,
    options.document,
    sidebar,
    deckParentElement,
  );

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
    themeCleanup,
  };
}

export function removeSidebarLayout(elements: Partial<SidebarElements>): void {
  elements.themeCleanup?.();
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

function syncSidebarThemeClass(
  window: _ZoteroTypes.MainWindow,
  document: Document,
  sidebar: XULElement,
  deckParent: Element,
): void {
  sidebar.classList.toggle(
    "is-dark-theme",
    isDarkZoteroTheme(window, document, deckParent),
  );
}

function watchSidebarTheme(
  window: _ZoteroTypes.MainWindow,
  document: Document,
  sidebar: XULElement,
  deckParent: Element,
): () => void {
  try {
    const colorSchemeQuery = window.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    const syncTheme = () => {
      syncSidebarThemeClass(window, document, sidebar, deckParent);
    };
    const cleanupHandlers: Array<() => void> = [];

    if (colorSchemeQuery?.addEventListener) {
      colorSchemeQuery.addEventListener("change", syncTheme);
      cleanupHandlers.push(() => {
        colorSchemeQuery.removeEventListener("change", syncTheme);
      });
    } else if (colorSchemeQuery?.addListener) {
      colorSchemeQuery.addListener(syncTheme);
      cleanupHandlers.push(() => {
        colorSchemeQuery.removeListener(syncTheme);
      });
    }

    const observerConstructor = window.MutationObserver;
    if (observerConstructor && document.documentElement) {
      const rootObserver = new observerConstructor(syncTheme);
      rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lwt-tree-brighttext", "lwtheme-brighttext"],
      });
      cleanupHandlers.push(() => {
        rootObserver.disconnect();
      });
    }

    return () => {
      cleanupHandlers.forEach((cleanup) => cleanup());
    };
  } catch (_error) {
    return () => undefined;
  }
}

function isDarkZoteroTheme(
  window: _ZoteroTypes.MainWindow,
  document: Document,
  deckParent: Element,
): boolean {
  const configuredScheme = getZoteroColorSchemePref();
  if (configuredScheme === "dark") {
    return true;
  }
  if (configuredScheme === "light") {
    return false;
  }

  const colorSchemeQuery = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  );
  if (colorSchemeQuery) {
    return colorSchemeQuery.matches;
  }

  if (
    document.documentElement?.hasAttribute("lwt-tree-brighttext") ||
    document.documentElement?.hasAttribute("lwtheme-brighttext")
  ) {
    return true;
  }

  const candidates = [
    deckParent,
    document.getElementById("zotero-pane"),
    document.getElementById("appcontent"),
    document.body,
    document.documentElement,
  ];

  for (const candidate of candidates) {
    if (!candidate || !(candidate instanceof window.Element)) {
      continue;
    }
    const computedStyle = window.getComputedStyle(candidate);
    if (!computedStyle) {
      continue;
    }
    const color = parseCssColor(computedStyle.backgroundColor);
    if (!color) {
      continue;
    }
    return getRelativeLuminance(color) < 0.38;
  }

  return false;
}

function getZoteroColorSchemePref(): ZoteroColorScheme | null {
  try {
    return normalizeZoteroColorSchemePref(
      Zotero.Prefs.get(ZOTERO_COLOR_SCHEME_PREF),
    );
  } catch (_error) {
    return null;
  }
}

function normalizeZoteroColorSchemePref(
  value: unknown,
): ZoteroColorScheme | null {
  const numericValue = typeof value === "string" ? Number(value) : value;
  switch (numericValue) {
    case 0:
      return "dark";
    case 1:
      return "light";
    case 2:
      return "auto";
    default:
      return null;
  }
}

function parseCssColor(value: string): [number, number, number] | null {
  const match = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (!match) {
    return null;
  }

  const alpha = match[4] == null ? 1 : Number(match[4]);
  if (alpha === 0) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function getRelativeLuminance([red, green, blue]: [number, number, number]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
