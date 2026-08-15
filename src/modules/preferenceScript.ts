import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  GROUP_COLOR_PREF_KEYS,
  VERTICAL_TAB_STYLE_PREF_CONFIG,
  getPref,
  normalizeVerticalTabStylePrefValue,
  setPref,
} from "../utils/prefs";

const PREF_CONTROL_CONFIG = [
  {
    id: `${config.addonRef}-pref-enable-vertical-tabs`,
    key: "enableVerticalTabs" as const,
  },
  {
    id: `${config.addonRef}-pref-enable-horizontal-tab-enhance`,
    key: "enableHorizontalTabEnhance" as const,
  },
  {
    id: `${config.addonRef}-pref-enable-copy-reference`,
    key: "enableCopyReference" as const,
  },
  {
    id: `${config.addonRef}-pref-enable-go-to-attachment`,
    key: "enableGoToAttachment" as const,
  },
  {
    id: `${config.addonRef}-pref-enable-reload-tab`,
    key: "enableReloadTab" as const,
  },
] as const;

const RESET_BUTTON_ID = `${config.addonRef}-pref-reset-plugin-data`;

const DISPLAY_SELECT_CONFIG = [
  {
    id: `${config.addonRef}-pref-vertical-tab-title-mode`,
    key: "verticalTabTitleMode" as const,
  },
  {
    id: `${config.addonRef}-pref-vertical-tab-subtitle-mode`,
    key: "verticalTabSubtitleMode" as const,
  },
] as const;

const DISPLAY_NUMBER_INPUT_CONFIG = [
  {
    id: `${config.addonRef}-pref-vertical-tab-row-height`,
    key: "verticalTabRowHeight" as const,
    ...VERTICAL_TAB_STYLE_PREF_CONFIG.verticalTabRowHeight,
  },
  {
    id: `${config.addonRef}-pref-vertical-tab-font-size`,
    key: "verticalTabFontSize" as const,
    ...VERTICAL_TAB_STYLE_PREF_CONFIG.verticalTabFontSize,
  },
] as const;

const GROUP_COLOR_INPUT_CONFIG = GROUP_COLOR_PREF_KEYS.map((key, index) => ({
  id: `${config.addonRef}-pref-group-color-${index + 1}`,
  key,
})) as ReadonlyArray<{
  id: string;
  key: (typeof GROUP_COLOR_PREF_KEYS)[number];
}>;

function initPreference() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function registerPrefsScripts(window: Window) {
  addon.data.prefs = {
    window,
    bound: false,
  };
  bindPrefEvents();
}

function bindPrefEvents() {
  const prefsWindow = addon.data.prefs?.window;
  if (!prefsWindow || addon.data.prefs?.bound) {
    return;
  }

  PREF_CONTROL_CONFIG.forEach(({ id }) => {
    prefsWindow.document.getElementById(id)?.addEventListener("command", () => {
      void addon.hooks.onPrefsEvent("featureToggle", {});
    });
  });

  DISPLAY_SELECT_CONFIG.forEach(({ id, key }) => {
    const select = prefsWindow.document.getElementById(
      id,
    ) as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    select.value = String(getPref(key));
    select.addEventListener("change", () => {
      setPref(key, select.value as never);
      void addon.hooks.onPrefsEvent("displayPrefsChanged", {});
    });
  });

  DISPLAY_NUMBER_INPUT_CONFIG.forEach(({ id, key }) => {
    const input = prefsWindow.document.getElementById(
      id,
    ) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.value = String(normalizeVerticalTabStylePrefValue(key, getPref(key)));
    input.addEventListener("change", () => {
      const value = normalizeVerticalTabStylePrefValue(
        key,
        input.valueAsNumber,
      );
      input.value = String(value);
      setPref(key, value);
      void addon.hooks.onPrefsEvent("displayPrefsChanged", {});
    });
  });

  GROUP_COLOR_INPUT_CONFIG.forEach(({ id, key }) => {
    const input = prefsWindow.document.getElementById(
      id,
    ) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.value = String(getPref(key));
    const syncColor = () => {
      setPref(key, input.value as never);
      void addon.hooks.onPrefsEvent("displayPrefsChanged", {});
    };
    input.addEventListener("change", syncColor);
  });

  prefsWindow.document
    .getElementById(RESET_BUTTON_ID)
    ?.addEventListener("click", async () => {
      await addon.hooks.onPrefsEvent("resetPluginData", {
        window: prefsWindow,
      });
    });

  const prefsState = addon.data.prefs;
  if (prefsState) {
    prefsState.bound = true;
  }
}

function syncPrefControls(window: Window) {
  PREF_CONTROL_CONFIG.forEach(({ id, key }) => {
    const checkbox = window.document.getElementById(id) as
      HTMLInputElement | XULCheckboxElement | null;
    if (!checkbox) {
      return;
    }
    const value = Boolean(getPref(key));
    if ("checked" in checkbox) {
      checkbox.checked = value;
    }
  });

  DISPLAY_SELECT_CONFIG.forEach(({ id, key }) => {
    const select = window.document.getElementById(
      id,
    ) as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    select.value = String(getPref(key));
  });

  DISPLAY_NUMBER_INPUT_CONFIG.forEach(({ id, key }) => {
    const input = window.document.getElementById(id) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.value = String(normalizeVerticalTabStylePrefValue(key, getPref(key)));
  });

  GROUP_COLOR_INPUT_CONFIG.forEach(({ id, key }) => {
    const input = window.document.getElementById(id) as HTMLInputElement | null;
    if (!input) {
      return;
    }
    input.value = String(getPref(key));
  });
}

export {
  initPreference,
  registerPrefsScripts,
  bindPrefEvents,
  syncPrefControls,
};
