function install() {
  // No operation on install
}

async function startup({ id, version, rootURI }) {
  // Wait for Zotero to fully initialize
  await Zotero.initializationPromise;
  
  // Load tab enhancement module
  try {
    Services.scriptloader.loadSubScript(rootURI + "modules/tabEnhance.js");
    
    // Add listeners to existing windows
    const windows = Zotero.getMainWindows();
    for (const window of windows) {
      Zotero.TabEnhance.init(window);
    }
  } catch (e) {
    // 使用详细的错误日志格式
    Zotero.debug(`TabEnhance: Error loading module - ${e.message || e}`);
    Zotero.debug(`TabEnhance: Error details - ${e.toString()}`);
    Zotero.debug(`TabEnhance: Error stack - ${e.stack}`);
  }
}

function onMainWindowLoad({ window }) {
  if (typeof Zotero.TabEnhance !== 'undefined') {
    Zotero.TabEnhance.init(window);
  }
}

function onMainWindowUnload({ window }) {
  // Cleanup on window close
  if (typeof Zotero.TabEnhance !== 'undefined') {
    Zotero.TabEnhance.destroy(window);
  }
}

function shutdown() {
  
  // Cleanup all instances
  if (typeof Zotero.TabEnhance !== 'undefined') {
    // Use new unload method
    Zotero.TabEnhance.unload();
    // Don't delete Zotero.TabEnhance, let it check itself on next startup
  }
}

function uninstall() {
  shutdown();
  // Try to completely remove module reference on uninstall
  if (typeof Zotero.TabEnhance !== 'undefined') {
    delete Zotero.TabEnhance;
  }
}
