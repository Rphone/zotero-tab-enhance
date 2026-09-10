import SidebarViewRenderer from "../../src/modules/verticalTabs/sidebarView";
import TabGroupStore from "../../src/modules/verticalTabs/groupStore";
import { TrackedTab } from "../../src/modules/verticalTabs/types";

type SubtitleRenderer = {
  displaySubtitleMode: string;
  getDisplaySubtitle: (
    input: Pick<TrackedTab, "type" | "itemID" | "parentItemID" | "isOpen">,
    deferred: boolean,
  ) => string;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

describe("sidebar child note subtitles", function () {
  let originalZotero: typeof Zotero;
  let renderer: SubtitleRenderer;

  beforeEach(function () {
    originalZotero = globalThis.Zotero;
    Object.assign(globalThis, {
      Zotero: {
        Items: {
          get: (id: number) =>
            id === 100
              ? {
                  id,
                  getField: (field: string) =>
                    ({
                      title: "Parent article title",
                      publicationTitle: "Journal name",
                      firstCreator: "Author",
                      year: "2026",
                    })[field] ?? "",
                }
              : null,
        },
      },
    });
    renderer = new SidebarViewRenderer(
      {} as _ZoteroTypes.MainWindow,
      {} as Document,
      {} as TabGroupStore,
    ) as unknown as SubtitleRenderer;
  });

  afterEach(function () {
    Object.assign(globalThis, { Zotero: originalZotero });
  });

  for (const type of ["note", "note-unloaded"]) {
    for (const isOpen of [true, false]) {
      it(`shows the parent title for ${type}, open=${isOpen}`, function () {
        const subtitle = renderer.getDisplaySubtitle(
          { type, itemID: 101, parentItemID: 100, isOpen },
          false,
        );
        assert(
          subtitle === "Parent article title",
          "expected parent title, not journal",
        );
      });
    }
  }

  it("preserves attachment source subtitles", function () {
    assert(
      renderer.getDisplaySubtitle(
        { type: "reader", itemID: 102, parentItemID: 100, isOpen: true },
        false,
      ) === "Journal name",
      "expected the attachment journal",
    );
  });

  it("preserves other subtitle modes and deferred metadata", function () {
    const note = { type: "note", itemID: 101, parentItemID: 100, isOpen: true };
    renderer.displaySubtitleMode = "none";
    assert(
      renderer.getDisplaySubtitle(note, false) === "",
      "expected hidden subtitle",
    );
    renderer.displaySubtitleMode = "creatorYear";
    assert(
      renderer.getDisplaySubtitle(note, false) === "Author · 2026",
      "expected creator/year mode",
    );
    renderer.displaySubtitleMode = "typeAndItem";
    assert(
      renderer.getDisplaySubtitle(note, false) === "note · item 100",
      "expected type/item mode",
    );
    renderer.displaySubtitleMode = "source";
    assert(
      renderer.getDisplaySubtitle(note, true) === "note · item 100",
      "expected deferred metadata fallback",
    );
  });

  it("does not replace standalone note subtitles with their own title", function () {
    assert(
      renderer.getDisplaySubtitle(
        { type: "note", itemID: 100, parentItemID: 100, isOpen: true },
        false,
      ) === "Journal name",
      "expected the existing source behavior for a standalone note",
    );
  });

  it("falls back to item metadata when the parent cannot be resolved", function () {
    assert(
      renderer.getDisplaySubtitle(
        { type: "note", itemID: 101, parentItemID: 999, isOpen: false },
        false,
      ) === "note · virtual · item 999",
      "expected metadata rather than a wrong source",
    );
  });
});
