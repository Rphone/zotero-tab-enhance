import {
  commitGroupMemberDrop,
  commitGroupMemberToTabDrop,
  getDropPosition,
  isNoOpGroupHeaderDropTarget,
  isNoOpGroupMemberDropTarget,
  isNoOpTabDropTarget,
  commitTabToGroupDrop,
  updateDropIndicator,
} from "../../src/modules/verticalTabs/sidebarDrag";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

describe("sidebarDrag", () => {
  it("detects no-op tab drops", () => {
    assert(
      isNoOpTabDropTarget({
        sourceTabKey: "tab-2",
        targetTabKey: "tab-1",
        position: "after",
        visibleKeys: ["tab-1", "tab-2", "tab-3"],
      }),
      "expected after-drop to previous row to be a no-op",
    );
    assert(
      isNoOpTabDropTarget({
        sourceTabKey: "tab-2",
        targetTabKey: "tab-3",
        position: "before",
        visibleKeys: ["tab-1", "tab-2", "tab-3"],
      }),
      "expected before-drop to next row to be a no-op",
    );
  });

  it("detects no-op group member and header drops", () => {
    assert(
      isNoOpGroupMemberDropTarget({
        sourceGroupId: "g1",
        sourceMemberKey: "m2",
        targetGroupId: "g1",
        targetMemberKey: "m1",
        position: "after",
        visibleKeys: ["m1", "m2", "m3"],
      }),
      "expected adjacent member reorder to be a no-op",
    );
    assert(
      isNoOpGroupHeaderDropTarget({
        sourceGroupId: "g2",
        targetGroupId: "g1",
        position: "after",
        visibleGroupIds: ["g1", "g2", "g3"],
      }),
      "expected adjacent group reorder to be a no-op",
    );
    assert(
      !isNoOpGroupMemberDropTarget({
        sourceGroupId: "g1",
        sourceMemberKey: "m2",
        targetGroupId: "g2",
        targetMemberKey: "m1",
        position: "after",
        visibleKeys: ["m1", "m3"],
      }),
      "expected cross-group member drop to remain actionable",
    );
    assert(
      isNoOpGroupMemberDropTarget({
        sourceGroupId: "g1",
        sourceMemberKey: "m2",
        targetGroupId: "g2",
        targetMemberKey: "m1",
        position: "after",
        visibleKeys: ["m1", "m2", "m3"],
      }),
      "expected cross-group duplicate member drop to be a no-op",
    );
  });

  it("reuses prior drag-over position inside hysteresis zone", () => {
    const row = {
      dataset: { tabKey: "tab-2" },
      getBoundingClientRect: () => ({ top: 0, height: 100 }),
    } as HTMLDivElement;
    const event = { clientY: 53 } as DragEvent;

    assert(
      getDropPosition({
        row,
        event,
        dragState: {
          draggedTabKey: "tab-1",
          draggedGroupId: null,
          draggedMemberKey: null,
          draggedHeaderGroupId: null,
          dragOverTabKey: "tab-2",
          dragOverGroupId: null,
          dragOverMemberKey: null,
          dragOverHeaderGroupId: null,
          dragOverPosition: "before",
        },
      }) === "before",
      "expected drag position to reuse prior side inside hysteresis",
    );
  });

  it("updates and clears member drop indicators without replacing rows", () => {
    const list = document.createElement("div");
    const sourceGroup = document.createElement("div");
    const targetGroup = document.createElement("div");
    const sourceMembers = document.createElement("div");
    const targetMembers = document.createElement("div");
    const targetHeader = document.createElement("div");
    const sourceRow = document.createElement("div");
    const targetRow = document.createElement("div");

    sourceGroup.className = "tab-enhance-vertical-group";
    sourceGroup.dataset.groupId = "g1";
    targetGroup.className = "tab-enhance-vertical-group is-expanded";
    targetGroup.dataset.groupId = "g2";
    sourceMembers.className = "tab-enhance-vertical-group-members";
    targetMembers.className = "tab-enhance-vertical-group-members";
    targetHeader.className = "tab-enhance-vertical-group-header";
    sourceRow.className = "tab-enhance-vertical-tab-row";
    sourceRow.dataset.groupId = "g1";
    sourceRow.dataset.memberKey = "m1";
    sourceRow.dataset.sortable = "true";
    targetRow.className = "tab-enhance-vertical-tab-row";
    targetRow.dataset.groupId = "g2";
    targetRow.dataset.memberKey = "m2";
    targetRow.dataset.sortable = "true";

    sourceMembers.appendChild(sourceRow);
    sourceGroup.appendChild(sourceMembers);
    targetMembers.appendChild(targetRow);
    targetGroup.appendChild(targetHeader);
    targetGroup.appendChild(targetMembers);
    list.appendChild(sourceGroup);
    list.appendChild(targetGroup);

    updateDropIndicator(list, {
      draggedTabKey: null,
      draggedGroupId: "g1",
      draggedMemberKey: "m1",
      draggedHeaderGroupId: null,
      dragOverTabKey: null,
      dragOverGroupId: "g2",
      dragOverMemberKey: "m2",
      dragOverHeaderGroupId: null,
      dragOverPosition: "before",
    });

    assert(sourceRow.parentNode === sourceMembers, "expected source row to remain mounted");
    assert(
      targetMembers.firstElementChild?.classList.contains(
        "tab-enhance-vertical-tab-placeholder",
      ),
      "expected placeholder before target member",
    );

    updateDropIndicator(list, {
      draggedTabKey: null,
      draggedGroupId: "g1",
      draggedMemberKey: "m1",
      draggedHeaderGroupId: null,
      dragOverTabKey: null,
      dragOverGroupId: "g2",
      dragOverMemberKey: null,
      dragOverHeaderGroupId: null,
      dragOverPosition: "after",
    });

    assert(
      list.querySelectorAll(".tab-enhance-vertical-tab-placeholder").length === 1,
      "expected only one placeholder after changing targets",
    );
    assert(
      targetMembers.lastElementChild?.classList.contains(
        "tab-enhance-vertical-tab-placeholder",
      ),
      "expected append placeholder at target group end",
    );
    assert(
      targetHeader.classList.contains("is-member-drop-target"),
      "expected target group header highlight",
    );

    updateDropIndicator(list, {
      draggedTabKey: null,
      draggedGroupId: null,
      draggedMemberKey: null,
      draggedHeaderGroupId: null,
      dragOverTabKey: null,
      dragOverGroupId: null,
      dragOverMemberKey: null,
      dragOverHeaderGroupId: null,
      dragOverPosition: null,
    });

    assert(
      !list.querySelector(".tab-enhance-vertical-tab-placeholder"),
      "expected placeholder to clear at drag end",
    );
    assert(
      !targetHeader.classList.contains("is-member-drop-target"),
      "expected target group header highlight to clear",
    );
  });

  it("commits same-group member drops as reorders", () => {
    let cleared = false;
    const calls: string[] = [];

    commitGroupMemberDrop({
      sourceGroupId: "g1",
      sourceMemberKey: "m1",
      targetGroupId: "g1",
      targetMemberKey: "m2",
      position: "before",
      clearDragState: () => {
        cleared = true;
      },
      reorderMember: (groupId, sourceMemberKey, targetMemberKey, position) => {
        calls.push(
          `${groupId}:${sourceMemberKey}:${targetMemberKey}:${position}`,
        );
      },
      moveMember: () => {
        throw new Error("expected same-group drop to reorder");
      },
    });

    assert(cleared, "expected drag state to clear");
    assert(
      JSON.stringify(calls) === JSON.stringify(["g1:m1:m2:before"]),
      "expected same-group drop to call reorder",
    );
  });

  it("commits cross-group member drops as moves", () => {
    let cleared = false;
    const calls: string[] = [];

    commitGroupMemberDrop({
      sourceGroupId: "g1",
      sourceMemberKey: "m1",
      targetGroupId: "g2",
      targetMemberKey: "m2",
      position: "after",
      clearDragState: () => {
        cleared = true;
      },
      reorderMember: () => {
        throw new Error("expected cross-group drop to move");
      },
      moveMember: (
        sourceGroupId,
        targetGroupId,
        sourceMemberKey,
        targetMemberKey,
        position,
      ) => {
        calls.push(
          `${sourceGroupId}:${targetGroupId}:${sourceMemberKey}:${targetMemberKey}:${position}`,
        );
      },
    });

    assert(cleared, "expected drag state to clear");
    assert(
      JSON.stringify(calls) === JSON.stringify(["g1:g2:m1:m2:after"]),
      "expected cross-group drop to call move",
    );
  });

  it("commits cross-group header drops as appends", () => {
    let cleared = false;
    const calls: string[] = [];

    commitGroupMemberDrop({
      sourceGroupId: "g1",
      sourceMemberKey: "m1",
      targetGroupId: "g2",
      targetMemberKey: null,
      position: "after",
      clearDragState: () => {
        cleared = true;
      },
      reorderMember: () => {
        throw new Error("expected cross-group header drop to append");
      },
      moveMember: (
        sourceGroupId,
        targetGroupId,
        sourceMemberKey,
        targetMemberKey,
        position,
      ) => {
        calls.push(
          `${sourceGroupId}:${targetGroupId}:${sourceMemberKey}:${targetMemberKey}:${position}`,
        );
      },
    });

    assert(cleared, "expected drag state to clear");
    assert(
      JSON.stringify(calls) === JSON.stringify(["g1:g2:m1:null:after"]),
      "expected cross-group header drop to append",
    );
  });

  it("commits ungrouped tab drops into groups", () => {
    let cleared = false;
    const calls: string[] = [];
    const tab = {
      key: "tab:1",
      tabId: "1",
      nativeIndex: 0,
    } as any;

    commitTabToGroupDrop({
      sourceTabKey: "tab:1",
      targetGroupId: "g1",
      targetMemberKey: "m2",
      position: "before",
      getTrackedTabByKey: (tabKey) => (tabKey === "tab:1" ? tab : null),
      clearDragState: () => {
        cleared = true;
      },
      addTabToGroup: (groupId, trackedTab, targetMemberKey, position) => {
        calls.push(
          `${groupId}:${trackedTab.key}:${targetMemberKey}:${position}`,
        );
      },
    });

    assert(cleared, "expected drag state to clear");
    assert(
      JSON.stringify(calls) === JSON.stringify(["g1:tab:1:m2:before"]),
      "expected ungrouped tab drop to add tab to group",
    );
  });

  it("commits group member drops back to ungrouped tabs", () => {
    let cleared = false;
    const calls: string[] = [];
    const sourceTab = {
      key: "tab:1",
      tabId: "1",
      nativeIndex: 0,
    } as any;
    const targetTab = {
      key: "tab:2",
      tabId: "2",
      nativeIndex: 4,
    } as any;

    commitGroupMemberToTabDrop({
      sourceGroupId: "g1",
      sourceMemberKey: "m1",
      targetTabKey: "tab:2",
      position: "after",
      getTrackedTabByKey: (tabKey) => (tabKey === "tab:2" ? targetTab : null),
      getTrackedTabByMemberKey: (memberKey) =>
        memberKey === "m1" ? sourceTab : null,
      clearDragState: () => {
        cleared = true;
      },
      removeMember: (groupId, memberKey) => {
        calls.push(`remove:${groupId}:${memberKey}`);
      },
      moveOpenTabs: (tabIds, targetIndex) => {
        calls.push(`move:${tabIds.join(",")}:${targetIndex}`);
      },
      reconcile: (reason) => {
        calls.push(`reconcile:${reason}`);
      },
      scheduleDelayedReconcile: (reason, delays) => {
        calls.push(`delay:${reason}:${delays.join(",")}`);
      },
    });

    assert(cleared, "expected drag state to clear");
    assert(
      JSON.stringify(calls) ===
        JSON.stringify([
          "remove:g1:m1",
          "move:1:5",
          "reconcile:sidebar-ungroup-move:1:5",
          "delay:sidebar-ungroup-move:1:5:80,220",
        ]),
      "expected group member drop to ungroup and move open tab",
    );
  });
});
