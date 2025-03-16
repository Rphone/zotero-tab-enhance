function install() {
  // No operation on install
}

let windowListener;

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
    // Error handling
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
  // Remove window listener
  if (windowListener) {
    Services.wm.removeListener(windowListener);
    windowListener = null;
  }
  
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
