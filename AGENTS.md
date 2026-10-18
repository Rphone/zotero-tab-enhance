# AGENT Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project Notes: zotero-tab-enhance

This repository is a Zotero add-on project. Its goal is to enhance Zotero's tab experience, mainly around two areas:

- horizontal tab context-menu enhancements
- vertical tab sidebar, grouping, ordering, and display customization

Before changing code, AGENT should first identify which layer is being touched: lifecycle/bootstrap, feature modules, preferences/UI assets, styles, or build/release config. Avoid mixing concerns unless the requested change truly crosses module boundaries.

### Module map

- `src/index.ts`: runtime entry. Creates the global add-on singleton and exposes shared globals.
- `src/addon.ts`: add-on state container. Holds global config, toolkit instance, and per-window feature instances.
- `src/hooks.ts`: lifecycle and orchestration layer. Handles startup/shutdown, main-window load/unload, notifier registration, preference events, tab-notifier-triggered reconciles, and awaited feature enable/disable syncing. Registers pending sidebar instances before initialization so unloads and preference changes can cancel them.
- `src/modules/tabEnhance.ts`: horizontal tab enhancement module. Injects extra context-menu actions for tabs.
- `src/modules/itemMenuEnhance.ts`: Zotero item context-menu module. Adds item-list actions that open selected items or attachments and place the resulting reader tabs into vertical-tab groups.
- `src/modules/preferenceScript.ts`: preferences pane integration. Registers the preference pane, binds preference controls, and syncs UI state.
- `src/modules/verticalTabs/sidebar.ts`: vertical tabs coordinator. Owns lifecycle wiring, subscriptions, active-tab selection transitions, global listeners, render scheduling, display-style preference application, inline group-name edit flow, grouped-member reopen flow, and delegates layout/persistence/render/menu/drag helpers.
- `src/modules/verticalTabs/sidebarCommon.ts`: shared vertical-sidebar constants and internal types for layout, drag state, persisted state, and menu/view coordination.
- `src/modules/verticalTabs/sidebarLayout.ts`: sidebar DOM mount/unmount helper. Creates the sidebar shell, splitter, search input, view switcher, and context-menu host elements.
- `src/modules/verticalTabs/sidebarPersistence.ts`: sidebar persistence helper. Asynchronously restores sidebar UI state and group snapshots, loads member/current-tab and parent display metadata, and sanitizes restored group/member payloads using cache-independent item existence checks.
- `src/modules/verticalTabs/sidebarMenu.ts`: sidebar context-menu helper. Builds tab, group-member, and group-header menus plus group/color submenus.
- `src/modules/verticalTabs/sidebarDrag.ts`: sidebar drag-and-drop helper. Owns drag-state shape plus no-op detection, drop-target resolution, and drop commit helpers.
- `src/modules/verticalTabs/sidebarView.ts`: sidebar renderer. Owns aggregate/default view rendering, row/group DOM creation, search/display formatting, and display-metadata cache helpers.
- `src/modules/verticalTabs/tabTracker.ts`: tab tracking service. Reads Zotero runtime tab state, normalizes tab snapshots (including attachment-type icon keys), and notifies subscribers only when tracked fields, order, or selection change; new subscriptions still receive the current snapshot immediately.
- `src/modules/verticalTabs/groupStore.ts`: in-memory group state manager. Owns group creation, membership, batched additions with one change notification, ungrouped-tab filtering, reordering, collapse state (including focused-tab expansion), and synchronization with tracked tabs.
- `src/modules/verticalTabs/tabCommands.ts`: command adapter for native tab operations such as select, close, move, reload, open attachment/note tabs, show in library, show in filesystem, and single-tab or group reference copying.
- `src/modules/verticalTabs/collapsible.ts`: helper logic for collapsible group UI state and measured heights.
- `src/modules/verticalTabs/types.ts`: shared types and constants for the vertical-tabs subsystem, including the reader-type icon-key mapping.
- `src/utils/prefs.ts`: plugin preference access, bounded vertical-tab and group-header display metrics, defaults (including the eight group-color slots), JSON persistence helpers, and reset logic.
- `src/utils/locale.ts`: localization helpers for Fluent strings.
- `src/utils/window.ts`: window-related helpers.
- `src/utils/ztoolkit.ts`: creates one shared lightweight toolkit with UI and helper APIs. Example-only Keyboard/Prompt managers are initialized on demand; normal startup does not install unused global keyboard listeners or item-field hooks.
- `addon/`: packaged add-on assets shipped to Zotero, including `manifest.json`, `bootstrap.js`, `prefs.js`, preference markup, CSS, icons, and locale files.
- `addon/content/preferences.xhtml`: preference pane markup.
- `addon/content/preferences.css`: responsive preference-pane layout and control styling.
- `addon/content/zoteroPane.css`: main shipped styles for Zotero pane and vertical tab UI.
- `addon/locale/*`: localized Fluent resources for add-on text.
- `assets/`: design or repository assets not directly acting as runtime source code.
- `doc/`: project documentation and design notes.
- `test/`: automated test-related files and test config.
- `typings/`: local type declarations and supplemental typing support.
- `bootstrap.js`, `zotero-plugin.config.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs`: scaffold/build/tooling entrypoints. Treat these as build-system files, not feature modules.

### Working rules for this repository

- When changing feature behavior, check whether the change belongs in `src/modules/*`, `src/utils/*`, and shipped assets under `addon/`.
- When changing preferences, update both the preference logic in `src/modules/preferenceScript.ts` / `src/utils/prefs.ts` and the corresponding UI or locale assets in `addon/`.
- When changing vertical tab behavior, review the full chain: `tabTracker.ts`, `groupStore.ts`, `sidebar.ts`, `sidebarLayout.ts`, `sidebarPersistence.ts`, `sidebarMenu.ts`, `sidebarDrag.ts`, `sidebarView.ts`, `tabCommands.ts`, related types, and CSS.
- When changing sidebar rendering or display formatting, prefer edits in `sidebarView.ts`; only touch `sidebar.ts` if the change affects orchestration, lifecycle, or cross-module state flow.
- When changing sidebar persistence or restored-state shape, update `sidebarPersistence.ts` together with any preference defaults, tests, and this file if responsibilities change again.
- Sidebar initialization awaits persisted members, current tabs, and their parent metadata before mounting, subscribing, or saving state. Existing but uncached items must not be treated as deleted; malformed group JSON or loading failures must preserve the original preferences. No fixed startup delay or automatic reader-tab opening is used.
- Pending sidebar initialization is shared per instance and invalidated by destruction. Window unloads, disabling vertical tabs, and data resets must prevent late mounting or stale preference writes. Refresh the tab snapshot after loading, do not cache transient parent/item lookup failures, and keep metadata rendering resilient to temporarily unloaded items.
- Reuse the add-on's toolkit across main windows. Window unload only destroys that window's feature instances; global toolkit cleanup belongs to add-on shutdown. Avoid constructing the full toolkit merely to use UI helpers because its unused managers can patch native Zotero item methods and install global listeners.
- Keep sidebar theme cleanup attached to its mounted elements and invoke it exactly once on destruction. Dispose pending search/render timers during destruction. Search input coalesces filtering and persistence over the existing 200 ms search delay; entering inline group-name editing cancels pending search work and saves the current query before focusing the editor.
- Collapsed group sections retain their headers/counts/search matching but do not construct hidden member rows. Expanding immediately renders those rows and animates them open from the collapsed state; collapsing retains its animation. Disposable sidebar row nodes are removed by their owning sidebar and must opt out of toolkit element recording, including reader-load row patches.
- Batch item-menu additions through `TabGroupStore.addTabsToGroup` so one batch emits and persists once. Preserve member order, IDs, note identity, and reader aliases; unchanged additions must not notify. Single-group lookup copies only the requested group's members.
- Reader-family tabs (`reader`, `reader-loading`, `reader-unloaded`) take their badge icon key from the attachment's `attachmentReaderType` through `getReaderIconKey`: PDF → `reader` (P), EPUB → `epub` (E), web snapshot → `web` (W). The deferred reader-load row patch keeps the tracked icon key instead of forcing `reader`, and the type view lists web snapshots under Web.
- Tracker no-change detection must cover every `TrackedTab` field, tab ordering, and `selectedTabKey`; keep it in sync when extending the snapshot shape. Independent deferred metadata refreshes must remain available when metadata changes without a tab snapshot change.
- When changing sidebar menu or drag behavior, keep `sidebarMenu.ts` and `sidebarDrag.ts` focused on isolated UI mechanics instead of re-expanding `sidebar.ts`.
- The vertical-sidebar tab and group-member context menus expose Zotero's native "Show in Library" action through `ZoteroPane_Local.selectItem`; keep this sidebar-only menu entry separate from `tabEnhance.ts` so the horizontal native menu does not receive a duplicate item.
- The vertical-sidebar group-header menu copies references for all stored group members, including closed or search-hidden members, under the existing `enableCopyReference` preference. Resolve and deduplicate their top-level Zotero items before one native Quick Copy clipboard call, preserving the single-tab copy format and locale behavior; empty or unresolvable groups must leave the clipboard unchanged.
- When the active Zotero tab changes, every collapsed vertical group containing that tab automatically expands and the sidebar scrolls the selected row into view without stealing content focus. Routine reconciles with an unchanged selection must not reopen a group that the user manually collapsed or move the sidebar scroll position, and unrelated groups must remain unchanged.
- The vertical sidebar header `+` button groups all currently ungrouped open tabs into one new group; the tab context-menu "Create Group" action remains the single-tab group creation path. Keep these behaviors separate when changing group creation.
- The inline new-group header appears after existing groups and before ungrouped tabs, matching the saved group's position. Starting inline name editing scrolls the header into view and focuses/selects the name without a second focus-induced scroll.
- Clicking the header `+` immediately appends an expanded group containing all ungrouped tabs, clears any search filter, then edits that real group's name. Confirming renames the existing group; Escape keeps the created group and its default name. The single-tab context-menu creation flow remains separate.
- Dragging a vertical group member onto another visible member row inserts before/after that row; dragging it onto another group header appends it to that group. Dragging an ungrouped visible tab onto a group member/header adds it to that group, and dragging an open group member onto the ungrouped tab list removes it from its group and repositions the open tab there. Keep duplicate-member targets and closed-member-to-ungrouped targets as no-ops that clear the drag indicator.
- The Zotero item context-menu group actions live in `itemMenuEnhance.ts` and delegate actual opening/grouping to `VerticalTabSidebar`; keep item-menu UI separate from tab context-menu UI.
- Closed note group members (including `note-unloaded`) reopen through `Zotero.Notes.open` in a background tab, never through attachment resolution or `FileHandlers.open`. Both sidebar activation/group reopening and the member context-menu load action use the note command; single-member activation selects the reopened tab, while batch opening stays in the background.
- The member context-menu load action checks `member.itemID` for a note before using parent-first attachment fallback. Regression tests must distinguish the child note from its regular parent item, cover parents with and without attachments, and assert the opened note ID.
- Note and `note-unloaded` membership lookup uses the note's own identity without parent-item aliases. Sibling notes and PDFs sharing a bibliographic parent must remain distinct when filtering ungrouped tabs, synchronizing members, and restoring selection; reader attachment aliases remain supported.
- In source subtitle mode, child `note` and `note-unloaded` rows show their parent item's full title instead of its journal/source, including closed group members. Other subtitle modes, standalone notes, attachments, and deferred-metadata behavior remain unchanged.
- When changing user-visible text, update locale files under `addon/locale/`.
- Do not treat generated/package-facing assets in `addon/` as isolated from `src/`; verify whether the runtime change also requires matching packaged asset changes.

### AGENTS.md maintenance requirement

If AGENT modifies, adds, or removes:

- user-facing features
- preferences or settings structure
- module boundaries or responsibilities
- lifecycle/bootstrap flow
- storage/persistence structure
- architecture or major data flow

then AGENT must update this `AGENTS.md` in the same task to keep the project description, module map, and maintenance guidance accurate.
