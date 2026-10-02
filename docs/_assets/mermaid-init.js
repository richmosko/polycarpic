// Loads Mermaid from CDN and themes every diagram from the design-system tokens
// (docs/DESIGN/tokens.css): the blue CHART ramp for nodes (chart-1 fill,
// chart-3 outline), the full chart ramp for series/pie, muted neutrals for edges.
//
// 2026-09-29 fix (Principal review of ARCH found diagrams unreadable — black
// node/cluster fills, edge-label text invisible against its own background):
// two root causes, both fixed here.
//   1. Every token this file read (--color-on-warning, --color-text, etc.) was
//      the OLD generic template naming. tokens.css moved to shadcn-native names
//      during the Monarch/Origin design passes and this file was never updated,
//      so every var() resolved to nothing and fell through to the browser's
//      default (near-black) `color` — the same near-black on every node/cluster/
//      label regardless of theme is exactly the symptom that was reported.
//   2. `darkMode` read the OS media query directly, ignoring toc.js's explicit
//      .light/.dark override — a page pinned to Light while the OS prefers dark
//      (or vice versa) rendered Mermaid's theme inverted from the page's own.
//      Fixed by deriving darkMode from the page's own RESOLVED --background
//      luminance (below), not by re-deriving "should this page be dark" from
//      class/media-query logic — checked during this fix and found that
//      tokens.css itself has no @media(prefers-color-scheme) fallback (only
//      the explicit .dark class toc.js toggles), so replicating toc.js's
//      class-then-OS-fallback logic here would have reintroduced the same
//      mismatch in "Auto" mode on an OS with a dark preference: mermaid would
//      go dark (from the OS query) while the page itself stayed light (since
//      its own tokens never shifted). Asking "is my own background dark"
//      instead of "what produced this page's theme" can't go stale if the
//      page's theming mechanism changes again later.
//
// Mermaid's color parser (khroma) doesn't understand OKLCH/hex-with-var(), so we
// resolve each token to sRGB hex via a temp element + canvas before handing it
// over. Diagrams re-render on light/dark changes — both the OS scheme and the
// .light/.dark class toggled by toc.js.
//
// Used by docs/{PRD,ARCH,SECURITY,DESIGN}/index.html.

(function () {
  // This <script defer> runs after the DOM is parsed but before Mermaid loads,
  // so .mermaid elements still hold their RAW source here. Capture it now — once
  // Mermaid renders, textContent becomes SVG and the source is lost.
  document.querySelectorAll(".mermaid").forEach(function (el) {
    if (el.dataset.source == null) el.dataset.source = el.textContent;
  });

  var mod = [
    'import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";',
    '',
    '// Disable auto-run immediately: the import may resolve after DOMContentLoaded,',
    '// so we drive rendering explicitly (and re-drive it on theme changes).',
    'mermaid.initialize({ startOnLoad: false });',
    '',
    '// Resolve any CSS color expression (var(), color-mix(), oklch()) to sRGB hex.',
    'function toHex(expr) {',
    '  var el = document.createElement("span");',
    '  el.style.color = expr; el.style.position = "absolute"; el.style.opacity = "0";',
    '  document.body.appendChild(el);',
    '  var resolved = getComputedStyle(el).color;',
    '  el.remove();',
    '  var cv = document.createElement("canvas"); cv.width = cv.height = 1;',
    '  var ctx = cv.getContext("2d", { willReadFrequently: true });',
    '  ctx.fillStyle = "#000"; ctx.fillStyle = resolved; ctx.fillRect(0, 0, 1, 1);',
    '  var d = ctx.getImageData(0, 0, 1, 1).data;',
    '  return "#" + [d[0], d[1], d[2]].map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");',
    '}',
    '',
    '// WCAG relative-luminance contrast (same formula used throughout',
    '// docs/DESIGN/design-system-spec.md § Accessibility) — picks whichever ink',
    '// candidate actually contrasts against a given fill, computed at render',
    '// time against the REAL resolved color, rather than assuming one ink wins',
    '// in both themes. Needed because chart-1 is a light-to-medium fill in BOTH',
    '// modes (light: medium blue; dark: pale blue) — neither --foreground nor',
    '// --background alone clears 4.5:1 against it in both modes (measured: fg',
    '// only clears it in light mode, bg only in dark mode).',
    'function relLuminance(hex) {',
    '  function lin(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }',
    '  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);',
    '  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);',
    '}',
    'function contrastRatio(hexA, hexB) {',
    '  var a = relLuminance(hexA), b = relLuminance(hexB);',
    '  var hi = Math.max(a, b), lo = Math.min(a, b);',
    '  return (hi + 0.05) / (lo + 0.05);',
    '}',
    'function bestInk(fillHex, candidates) {',
    '  var best = candidates[0], bestRatio = -1;',
    '  candidates.forEach(function (c) {',
    '    var r = contrastRatio(fillHex, c);',
    '    if (r > bestRatio) { bestRatio = r; best = c; }',
    '  });',
    '  return best;',
    '}',
    '',
    'function themeVars() {',
    '  // Nodes use the CHART (blue) palette: chart-1 fill, outlined in the same',
    '  // muted color as the edges/arrows.',
    '  var fg     = toHex("var(--foreground)");',
    '  var bg     = toHex("var(--background)");',
    '  var line   = toHex("var(--muted-foreground)");',
    '  var card   = toHex("var(--card)");',
    '  var muted  = toHex("var(--muted)");',
    '  var border = toHex("var(--border)");',
    '  var c1 = toHex("var(--chart-1)"), c2 = toHex("var(--chart-2)"), c3 = toHex("var(--chart-3)"),',
    '      c4 = toHex("var(--chart-4)"), c5 = toHex("var(--chart-5)");',
    '  var c2bg = toHex("color-mix(in srgb, var(--chart-2) 16%, var(--card))");',
    '  var c3bg = toHex("color-mix(in srgb, var(--chart-3) 16%, var(--card))");',
    '  var onChart1 = bestInk(c1, [fg, bg]);   // guaranteed-best-of-two-tokens ink for the chart-1 node fill, both modes',
    '  return {',
    '    darkMode: relLuminance(bg) < 0.5,   // "dark" means MY OWN background is dark, not a re-derivation of why',
    '    fontFamily: "Inter, system-ui, -apple-system, sans-serif",',
    '    background: card,',
    '    primaryColor: c1, primaryBorderColor: line, primaryTextColor: onChart1,',
    '    secondaryColor: c2bg, secondaryBorderColor: line, secondaryTextColor: fg,',
    '    tertiaryColor: c3bg, tertiaryBorderColor: line, tertiaryTextColor: fg,',
    '    mainBkg: c1, nodeBorder: line, nodeTextColor: onChart1,',
    '    lineColor: line, textColor: fg, titleColor: fg,',
    '    clusterBkg: muted, clusterBorder: border,',
    '    edgeLabelBackground: card,',
    '    pie1: c1, pie2: c2, pie3: c3, pie4: c4, pie5: c5,',
    '    actorBorder: line, actorBkg: c1, actorTextColor: onChart1,',
    '    signalColor: line, signalTextColor: fg,',
    '    labelBoxBkgColor: c1, labelBoxBorderColor: line, labelTextColor: onChart1,',
    '    loopTextColor: fg, noteBkgColor: c2bg, noteBorderColor: line, noteTextColor: fg',
    '  };',
    '}',
    '',
    'function render() {',
    '  document.querySelectorAll(".mermaid").forEach(function (el) {',
    '    if (el.dataset.source != null) el.innerHTML = el.dataset.source;',
    '    el.removeAttribute("data-processed");',
    '  });',
    '  var tv = themeVars();',
    '  try { window.__mermaidThemeVars = tv; } catch (e) {}   // read by scripts/print-pdf.mjs for PDF export',
    '  // Belt-and-suspenders on top of themeVariables: Mermaid maps the same',
    '  // theme variable to a different CSS property across diagram types (flow-',
    '  // chart vs. sequence vs. ER), and the edge-label defect the Principal',
    '  // flagged twice (invisible text, label reads as sitting ON the line) is',
    '  // exactly the kind of thing a variable mapping gap causes silently. Force',
    '  // the label pill and its text directly by selector so it can\'t regress',
    '  // to "transparent background, inherited text" on a diagram type that',
    '  // doesn\'t honor edgeLabelBackground the way flowcharts do.',
    '  var themeCSS = [',
    '    ".edgeLabel { background-color: " + tv.background + " !important; }",',
    '    ".edgeLabel rect { fill: " + tv.background + " !important; opacity: 1 !important; }",',
    '    ".edgeLabel .label, .edgeLabel tspan, .edgeLabel text { fill: " + tv.textColor + " !important; }",',
    '    ".cluster rect { fill: " + tv.clusterBkg + " !important; stroke: " + tv.clusterBorder + " !important; }",',
    '    ".cluster .cluster-label text, .cluster .cluster-label tspan, .cluster .cluster-label span { fill: " + tv.textColor + " !important; color: " + tv.textColor + " !important; }"',
    '  ].join("\\n");',
    '  mermaid.initialize({',
    '    startOnLoad: false,',
    '    securityLevel: "loose",',
    '    theme: "base",',
    '    themeCSS: themeCSS,',
    '    // SVG <text> labels (not HTML <foreignObject>) so diagrams render in',
    '    // print/PDF output — Chrome does not paint foreignObject when printing.',
    '    htmlLabels: false,',
    '    // useMaxWidth:false gives the <svg> explicit width AND height attributes',
    '    // (not width:100% / no height), which Chrome needs to paint it when',
    '    // printing; doc.css\'s `.mermaid svg { max-width: 100%; height: auto; }`',
    '    // fits the container on screen and on the printed page without',
    '    // touching this setting, so both stay fixed at once.',
    '    flowchart: { curve: "basis", htmlLabels: false, useMaxWidth: false },',
    '    sequence: { useMaxWidth: false }, gantt: { useMaxWidth: false }, er: { useMaxWidth: false },',
    '    themeVariables: tv',
    '  });',
    '  mermaid.run().catch(function (e) { console.warn("mermaid render error", e); });',
    '}',
    '',
    'if (document.readyState === "loading") {',
    '  document.addEventListener("DOMContentLoaded", render);',
    '} else {',
    '  render();',
    '}',
    '',
    '// Re-theme on OS scheme change and on explicit .light/.dark class toggles.',
    'if (window.matchMedia) {',
    '  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);',
    '}',
    'new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });'
  ].join("\n");

  var s = document.createElement("script");
  s.type = "module";
  s.textContent = mod;
  document.head.appendChild(s);
})();
