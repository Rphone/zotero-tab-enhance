import {
  getDropPosition,
  isNoOpGroupHeaderDropTarget,
  isNoOpGroupMemberDropTarget,
  isNoOpTabDropTarget,
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
});
