import { SIDEBAR, DropPosition } from "./sidebarCommon";
import { TrackedTab } from "./types";

export interface SidebarDragState {
  draggedTabKey: string | null;
  draggedGroupId: string | null;
  draggedMemberKey: string | null;
  draggedHeaderGroupId: string | null;
  dragOverTabKey: string | null;
  dragOverGroupId: string | null;
  dragOverMemberKey: string | null;
  dragOverHeaderGroupId: string | null;
  dragOverPosition: DropPosition | null;
}

export function createSidebarDragState(): SidebarDragState {
  return {
    draggedTabKey: null,
    draggedGroupId: null,
    draggedMemberKey: null,
    draggedHeaderGroupId: null,
    dragOverTabKey: null,
    dragOverGroupId: null,
    dragOverMemberKey: null,
    dragOverHeaderGroupId: null,
    dragOverPosition: null,
  };
}

export function isNoOpTabDropTarget(args: {
  sourceTabKey: string | null;
  targetTabKey: string | null;
  position: DropPosition | null;
  visibleKeys: string[];
}): boolean {
  const { sourceTabKey, targetTabKey, position, visibleKeys } = args;
  if (!sourceTabKey || !targetTabKey || !position) {
    return false;
  }

  const sourceIndex = visibleKeys.indexOf(sourceTabKey);
  const targetIndex = visibleKeys.indexOf(targetTabKey);
  if (sourceIndex < 0 || targetIndex < 0) {
    return false;
  }

  return (
    (position === "after" && targetIndex === sourceIndex - 1) ||
    (position === "before" && targetIndex === sourceIndex + 1)
  );
}

export function isNoOpGroupMemberDropTarget(args: {
  sourceGroupId: string | null;
  sourceMemberKey: string | null;
  targetGroupId: string | null;
  targetMemberKey: string | null;
  position: DropPosition | null;
  visibleKeys: string[];
}): boolean {
  const {
    sourceGroupId,
    sourceMemberKey,
    targetGroupId,
    targetMemberKey,
    position,
    visibleKeys,
  } = args;
  if (
    !sourceGroupId ||
    !sourceMemberKey ||
    !targetGroupId ||
    !targetMemberKey ||
    !position ||
    sourceGroupId !== targetGroupId
  ) {
    return false;
  }

  const sourceIndex = visibleKeys.indexOf(sourceMemberKey);
  const targetIndex = visibleKeys.indexOf(targetMemberKey);
  if (sourceIndex < 0 || targetIndex < 0) {
    return false;
  }

  return (
    (position === "after" && targetIndex === sourceIndex - 1) ||
    (position === "before" && targetIndex === sourceIndex + 1)
  );
}

export function isNoOpGroupHeaderDropTarget(args: {
  sourceGroupId: string | null;
  targetGroupId: string | null;
  position: DropPosition | null;
  visibleGroupIds: string[];
}): boolean {
  const { sourceGroupId, targetGroupId, position, visibleGroupIds } = args;
  if (!sourceGroupId || !targetGroupId || !position) {
    return false;
  }

  const sourceIndex = visibleGroupIds.indexOf(sourceGroupId);
  const targetIndex = visibleGroupIds.indexOf(targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return false;
  }

  return (
    (position === "after" && targetIndex === sourceIndex - 1) ||
    (position === "before" && targetIndex === sourceIndex + 1)
  );
}

export function getDropPosition(args: {
  row: HTMLDivElement;
  event: DragEvent;
  dragState: SidebarDragState;
}): DropPosition {
  const { row, event, dragState } = args;
  const rect = row.getBoundingClientRect();
  const pointerY = event.clientY ?? rect.top;
  const middleY = rect.top + rect.height / 2;
  const rowTabKey = row.dataset.tabKey ?? null;
  const rowGroupId = row.dataset.groupId ?? null;
  const rowMemberKey = row.dataset.memberKey ?? null;

  if (
    dragState.draggedHeaderGroupId &&
    rowGroupId === dragState.dragOverHeaderGroupId &&
    !rowMemberKey &&
    dragState.dragOverPosition &&
    Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
  ) {
    return dragState.dragOverPosition;
  }

  if (
    dragState.draggedGroupId &&
    rowGroupId === dragState.dragOverGroupId &&
    rowMemberKey === dragState.dragOverMemberKey &&
    dragState.dragOverPosition &&
    Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
  ) {
    return dragState.dragOverPosition;
  }

  if (
    dragState.draggedTabKey &&
    rowTabKey &&
    rowTabKey === dragState.dragOverTabKey &&
    dragState.dragOverPosition &&
    Math.abs(pointerY - middleY) <= SIDEBAR.DROP_HYSTERESIS
  ) {
    return dragState.dragOverPosition;
  }

  return pointerY < middleY ? "before" : "after";
}

export function resolveDropTargetFromPoint(
  listContainer: HTMLElement | undefined,
  clientY: number,
): { tabKey: string | null; position: DropPosition } | null {
  if (!listContainer) {
    return null;
  }

  const rows = Array.from(
    listContainer.querySelectorAll(
      '.tab-enhance-vertical-tab-row[data-sortable="true"][data-sort-kind="tabs"]',
    ),
  ) as HTMLDivElement[];
  if (!rows.length) {
    return null;
  }

  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    const middleY = rect.top + rect.height / 2;
    if (clientY < middleY) {
      return {
        tabKey: row.dataset.tabKey ?? null,
        position: "before",
      };
    }
  }

  const lastRow = rows[rows.length - 1];
  return {
    tabKey: lastRow.dataset.tabKey ?? null,
    position: "after",
  };
}

export function getSortableRowFromEventTarget(
  window: _ZoteroTypes.MainWindow,
  target: EventTarget | null,
): HTMLDivElement | null {
  const elementCtor = window.Element;
  if (!elementCtor || !target || !(target instanceof elementCtor)) {
    return null;
  }

  const row = (target as Element).closest(
    '.tab-enhance-vertical-tab-row[data-sortable="true"][data-sort-kind="tabs"]',
  );
  return row ? (row as HTMLDivElement) : null;
}

export function resolveGroupHeaderDropTargetFromPoint(
  listContainer: HTMLElement | undefined,
  clientY: number,
): { groupId: string | null; position: DropPosition } | null {
  if (!listContainer) {
    return null;
  }

  const groups = Array.from(
    listContainer.querySelectorAll(".tab-enhance-vertical-group[data-group-id]"),
  ) as HTMLDivElement[];
  if (!groups.length) {
    return null;
  }

  const firstGroup = groups[0];
  const firstRect = firstGroup.getBoundingClientRect();
  if (clientY < firstRect.top) {
    return {
      groupId: firstGroup.dataset.groupId ?? null,
      position: "before",
    };
  }

  for (const group of groups) {
    const groupId = group.dataset.groupId ?? null;
    const header = group.querySelector(
      '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
    ) as HTMLDivElement | null;
    if (!groupId || !header) {
      continue;
    }

    const groupRect = group.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const headerMidY = headerRect.top + headerRect.height / 2;
    const footerZoneTop = Math.max(headerRect.bottom + 12, groupRect.bottom - 16);

    if (clientY >= groupRect.top && clientY <= groupRect.bottom) {
      if (clientY <= headerMidY) {
        return {
          groupId,
          position: "before",
        };
      }
      if (clientY >= footerZoneTop) {
        return {
          groupId,
          position: "after",
        };
      }
      return null;
    }
  }

  const lastGroup = groups[groups.length - 1];
  return {
    groupId: lastGroup.dataset.groupId ?? null,
    position: "after",
  };
}

export function getSortableGroupHeaderFromEventTarget(
  window: _ZoteroTypes.MainWindow,
  target: EventTarget | null,
): HTMLDivElement | null {
  const elementCtor = window.Element;
  if (!elementCtor || !target || !(target instanceof elementCtor)) {
    return null;
  }

  const header = (target as Element).closest(
    '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
  );
  return header ? (header as HTMLDivElement) : null;
}

export function updateDropIndicator(
  listContainer: HTMLElement | undefined,
  dragState: SidebarDragState,
): void {
  if (!listContainer) {
    return;
  }

  const rows = listContainer.querySelectorAll(
    '.tab-enhance-vertical-tab-row[data-sortable="true"]',
  );
  rows.forEach((node: Element) => {
    const row = node as HTMLDivElement;
    row.classList.remove("is-dragging");
    const rowTabKey = row.dataset.tabKey ?? null;
    const rowMemberKey = row.dataset.memberKey ?? null;
    const rowGroupId = row.dataset.groupId ?? null;
    if (rowTabKey && rowTabKey === dragState.draggedTabKey && !rowGroupId) {
      row.classList.add("is-dragging");
    }
    if (
      rowGroupId &&
      rowGroupId === dragState.draggedGroupId &&
      rowMemberKey &&
      rowMemberKey === dragState.draggedMemberKey
    ) {
      row.classList.add("is-dragging");
    }
  });

  const headers = listContainer.querySelectorAll(
    '.tab-enhance-vertical-group-header[data-sortable="true"][data-sort-kind="groups"]',
  );
  headers.forEach((node: Element) => {
    const header = node as HTMLDivElement;
    header.classList.remove("is-dragging");
    const groupId = header.dataset.groupId ?? null;
    if (groupId && groupId === dragState.draggedHeaderGroupId) {
      header.classList.add("is-dragging");
    }
  });
}

export function commitTabDrop(args: {
  sourceTabKey: string | null;
  targetTabKey: string | null;
  position: DropPosition;
  getTrackedTabByKey: (tabKey: string | null) => TrackedTab | null;
  clearDragState: () => void;
  moveOpenTabs: (tabIds: string[], targetIndex: number) => void;
  reconcile: (reason: string) => void;
  scheduleDelayedReconcile: (reason: string, delays: number[]) => void;
}): void {
  const { sourceTabKey, targetTabKey, position, getTrackedTabByKey } = args;
  if (!sourceTabKey || !targetTabKey || sourceTabKey === targetTabKey) {
    args.clearDragState();
    return;
  }

  const sourceTab = getTrackedTabByKey(sourceTabKey);
  const targetTab = getTrackedTabByKey(targetTabKey);
  if (!sourceTab?.tabId || !targetTab?.tabId) {
    return;
  }

  const targetIndex = targetTab.nativeIndex + (position === "after" ? 1 : 0);
  args.clearDragState();
  args.moveOpenTabs([sourceTab.tabId], targetIndex);
  const reason = `sidebar-move:${sourceTab.tabId}:${targetIndex}`;
  args.reconcile(reason);
  args.scheduleDelayedReconcile(reason, [80, 220]);
}

export function commitGroupMemberDrop(args: {
  sourceGroupId: string | null;
  sourceMemberKey: string | null;
  targetGroupId: string | null;
  targetMemberKey: string | null;
  position: DropPosition;
  clearDragState: () => void;
  reorderMember: (
    groupId: string,
    sourceMemberKey: string,
    targetMemberKey: string,
    position: DropPosition,
  ) => void;
}): void {
  const {
    sourceGroupId,
    sourceMemberKey,
    targetGroupId,
    targetMemberKey,
    position,
  } = args;
  if (
    !sourceGroupId ||
    !sourceMemberKey ||
    !targetGroupId ||
    !targetMemberKey ||
    sourceGroupId !== targetGroupId ||
    sourceMemberKey === targetMemberKey
  ) {
    args.clearDragState();
    return;
  }

  args.clearDragState();
  args.reorderMember(sourceGroupId, sourceMemberKey, targetMemberKey, position);
}

export function commitGroupHeaderDrop(args: {
  sourceGroupId: string | null;
  targetGroupId: string | null;
  position: DropPosition;
  clearDragState: () => void;
  reorderGroup: (
    sourceGroupId: string,
    targetGroupId: string,
    position: DropPosition,
  ) => void;
}): void {
  const { sourceGroupId, targetGroupId, position } = args;
  if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
    args.clearDragState();
    return;
  }

  args.clearDragState();
  args.reorderGroup(sourceGroupId, targetGroupId, position);
}
