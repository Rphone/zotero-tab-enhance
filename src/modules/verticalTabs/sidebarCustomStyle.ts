const SIDEBAR_SCOPE =
  ":where(.tab-enhance-vertical-tabs-sidebar, .tab-enhance-vertical-tabs-sidebar *)";

/**
 * Rewrites user CSS so every rule only matches the vertical sidebar and its
 * descendants while keeping the selector's specificity. Only @media and
 * @supports blocks are kept: other at-rules (@import, @font-face, @keyframes,
 * ...) load resources or define names for the whole window.
 */
export function scopeSidebarCustomCSS(window: Window, cssText: string): string {
  if (!cssText.trim()) {
    return "";
  }
  const sheet: CSSStyleSheet = new window.CSSStyleSheet();
  sheet.replaceSync(cssText);
  return serializeScopedRules(window, sheet.cssRules);
}

function serializeScopedRules(window: Window, rules: CSSRuleList): string {
  return Array.from(rules, (rule) => {
    if (rule instanceof window.CSSStyleRule) {
      const styleRule = rule as CSSStyleRule;
      const selectors = splitSelectorList(styleRule.selectorText).map(
        scopeSelector,
      );
      return `${selectors.join(", ")} { ${styleRule.style.cssText} }`;
    }
    if (rule instanceof window.CSSMediaRule) {
      const mediaRule = rule as CSSMediaRule;
      return `@media ${mediaRule.media.mediaText} { ${serializeScopedRules(window, mediaRule.cssRules)} }`;
    }
    if (rule instanceof window.CSSSupportsRule) {
      const supportsRule = rule as CSSSupportsRule;
      return `@supports ${supportsRule.conditionText} { ${serializeScopedRules(window, supportsRule.cssRules)} }`;
    }
    return "";
  })
    .filter(Boolean)
    .join("\n");
}

function scopeSelector(selector: string): string {
  const trimmed = selector.trim();
  // `:is()` cannot contain pseudo-elements, so keep them after the scope.
  const pseudoElementIndex =
    getTopLevelIndexes(trimmed).find((index) =>
      trimmed.startsWith("::", index),
    ) ?? trimmed.length;
  const subject = trimmed.slice(0, pseudoElementIndex);
  // `::before` and `a > ::before` apply the pseudo-element to any element.
  const target = /(^|[\s>+~])$/.test(subject) ? `${subject}*` : subject;
  return `${SIDEBAR_SCOPE}:is(${target})${trimmed.slice(pseudoElementIndex)}`;
}

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  for (const index of getTopLevelIndexes(selectorText)) {
    if (selectorText[index] === ",") {
      selectors.push(selectorText.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(selectorText.slice(start));
  return selectors;
}

// Indexes of characters outside escapes, strings, brackets and parentheses.
function getTopLevelIndexes(text: string): number[] {
  const indexes: number[] = [];
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      index++;
    } else if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    } else if (depth === 0) {
      indexes.push(index);
    }
  }
  return indexes;
}
