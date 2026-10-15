import {
  BasicTool,
  ClipboardHelper,
  DialogHelper,
  FilePickerHelper,
  KeyboardManager,
  ProgressWindowHelper,
  PromptManager,
  UITool,
  makeHelperTool,
} from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const _ztoolkit = new MyToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  const isProduction = env === "production";
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = isProduction;
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = __env__ === "development";
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = __env__ === "development";
  if (isProduction) {
    (_ztoolkit as unknown as { log: (...args: unknown[]) => void }).log = () =>
      undefined;
  }
  // Getting basicOptions.debug will load global modules like the debug bridge.
  // since we want to deprecate it, should avoid using it unless necessary.
  // _ztoolkit.basicOptions.debug.disableDebugBridgePassword =
  //   __env__ === "development";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}

class MyToolkit extends BasicTool {
  UI = new UITool(this);
  Clipboard = makeHelperTool(ClipboardHelper, this);
  Dialog = makeHelperTool(DialogHelper, this);
  FilePicker = makeHelperTool(FilePickerHelper, this);
  ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
  private keyboardManager?: KeyboardManager;
  private promptManager?: PromptManager;

  // Scaffold examples can opt into managers without installing their global
  // listeners or field hooks during normal plugin startup.
  get Keyboard(): KeyboardManager {
    return (this.keyboardManager ??= new KeyboardManager(this));
  }

  get Prompt(): PromptManager {
    return (this.promptManager ??= new PromptManager(this));
  }

  unregisterAll() {
    this.UI.unregisterAll();
    this.keyboardManager?.unregisterAll();
    this.promptManager?.unregisterAll();
  }
}
