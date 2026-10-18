import { scopeSidebarCustomCSS } from "../../src/modules/verticalTabs/sidebarCustomStyle";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const SCOPE =
  ":where(.tab-enhance-vertical-tabs-sidebar, .tab-enhance-vertical-tabs-sidebar *)";

describe("sidebar custom CSS", function () {
  it("returns no CSS for an empty value", function () {
    assert(scopeSidebarCustomCSS(window, " \n ") === "", "expected empty CSS");
  });

  it("scopes every selector and keeps pseudo-elements after the scope", function () {
    const css = scopeSidebarCustomCSS(
      window,
      '.tab-enhance-vertical-tab-row, :is(a, b)[title="x,y"] { color: red; } .tab-enhance-vertical-group::before { content: "x"; }',
    );

    assert(
      css.includes(
        `${SCOPE}:is(.tab-enhance-vertical-tab-row), ${SCOPE}:is(:is(a, b)[title="x,y"]) { color: red; }`,
      ),
      "expected each selector in the list to be scoped",
    );
    assert(
      css.includes(`${SCOPE}:is(.tab-enhance-vertical-group)::before {`),
      "expected the pseudo-element outside :is()",
    );
  });

  it("keeps @media and @supports blocks and drops other at-rules", function () {
    const css = scopeSidebarCustomCSS(
      window,
      '@import url("x.css"); @font-face { font-family: x; src: url(x.woff); } @keyframes spin { to { opacity: 0; } } @media (min-width: 1px) { @supports (display: grid) { span { color: red; } } }',
    );

    assert(
      !/@import|@font-face|@keyframes/.test(css),
      "expected window-wide at-rules to be dropped",
    );
    assert(
      css.includes(
        `@media (min-width: 1px) { @supports (display: grid) { ${SCOPE}:is(span) {`,
      ),
      "expected conditional blocks to keep scoped rules",
    );
  });

  it("styles only the sidebar and its descendants", function () {
    const sidebar = document.createElement("div");
    sidebar.className = "tab-enhance-vertical-tabs-sidebar";
    const inside = document.createElement("span");
    sidebar.appendChild(inside);
    const outside = document.createElement("span");
    const style = document.createElement("style");
    style.textContent = scopeSidebarCustomCSS(
      window,
      "span, .tab-enhance-vertical-tabs-sidebar { order: 7; }",
    );
    document.documentElement.append(style, sidebar, outside);

    try {
      assert(
        window.getComputedStyle(sidebar).order === "7",
        "expected the sidebar itself to be styled",
      );
      assert(
        window.getComputedStyle(inside).order === "7",
        "expected sidebar descendants to be styled",
      );
      assert(
        window.getComputedStyle(outside).order === "0",
        "expected elements outside the sidebar to keep their style",
      );
    } finally {
      style.remove();
      sidebar.remove();
      outside.remove();
    }
  });
});
