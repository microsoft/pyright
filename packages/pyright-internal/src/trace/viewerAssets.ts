/*
 * viewerAssets.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

export const viewerHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pyright evaluation viewer</title><link rel="stylesheet" href="style.css"></head>
<body><header><h1>Pyright evaluation viewer</h1><div id="artifact"></div>
<details id="coverage"><summary>Capture status &amp; coverage</summary><div id="coverage-body"></div></details></header>
<aside id="session-status" aria-label="Capture status and shared cursor">
<div id="status" role="status">Loading local artifact...</div>
<p class="warning">Latest OBSERVED fields, not continuously current native state. References are not dependency proof.</p>
<div id="error" role="alert" hidden></div>
<form id="cursor-form"><label>Sequence cursor <input id="cursor" type="number" min="0" value="0"></label>
<button>Go</button><span id="cursor-label"></span></form></aside>
<main>
<section id="timeline-panel"><h2>Evaluation timeline</h2><p>Inclusive of nested native work</p>
<form id="filters"><label>Events <select id="kind"><option value="enter">Occurrences</option></select></label>
<label>Search <input id="query" maxlength="200" placeholder="label, path, role, identity"></label>
<label>Role <input id="role" placeholder="ordinary, baseline, candidate"></label>
<label>Scope <input id="scope" placeholder="occurrence ID (optional)"></label>
<button>Apply</button></form><div id="timeline"></div><nav id="timeline-pages"></nav>
<h3>Selected event / native hook</h3><div id="event-details">Select a timeline row.</div></section>
<section id="state-panel"><h2>Observed relationship graph</h2>
<form id="entity-form"><label>Entity or occurrence <input id="entity-id" required></label><button>Inspect</button>
<label>Edges <select id="relation"><option value="all">All</option><option value="reference">References</option>
<option value="observed">Executed reads / returns</option></select></label>
<label>Hops <select id="hops"><option>1</option><option>2</option></select></label></form>
<p class="legend"><span class="ref-key">Solid: reference at source version</span>
<span class="read-key">Dashed blue: executed read</span><span class="return-key">Dashed amber: executed return</span></p>
<div id="graph-note"></div><div id="graph" aria-label="Object relationship graph"></div>
<details><summary>Graph edge list</summary><div id="edge-list"></div></details>
<h3>Selected identity / fields</h3><div id="entity-details">Select an event reference or graph node.</div>
<nav id="field-pages"></nav><h3>Observation history</h3><div id="history"></div><nav id="history-pages"></nav>
</section>
<section id="comparison-panel"><h2>Baseline / candidate comparison</h2>
<p>Native counts include nested work; the six boundaries and first results use owning-trial ancestry.</p>
<div id="pairs"></div><nav id="pair-pages"></nav><div id="comparison"></div><nav id="comparison-pages"></nav></section>
</main><script src="client.js"></script></body></html>`;

export const viewerCss = `
:root{color-scheme:light dark;font:14px system-ui,sans-serif;background:#111821;color:#e4eaf0}
*{box-sizing:border-box}body{margin:0}header{padding:16px 24px;border-bottom:1px solid #35475a;background:#182330}
h1{font-size:22px;margin:0 0 5px}h2{font-size:18px;margin:0 0 6px}h3{font-size:15px;margin:18px 0 8px}
p{margin:6px 0 10px}button,input,select{font:inherit;border:1px solid #536c83;border-radius:4px;background:#172536;color:inherit;padding:6px}
button{cursor:pointer}button:hover,button:focus-visible{background:#304c65;outline:2px solid #70bdfa}
button:disabled{opacity:.45;cursor:default}input{max-width:100%;min-width:80px}label{display:inline-flex;gap:5px;align-items:center}
form{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}#filters label{flex-wrap:wrap}#filters input{width:175px}
#cursor{width:115px}#entity-id{width:250px}.warning,#graph-note{color:#f1c987}
#status{font-weight:600;color:#a8d8b9;margin-top:6px}#error{background:#681f32;padding:12px;white-space:pre-wrap}
#session-status{position:sticky;top:0;z-index:3;padding:6px 24px;background:#182330;border-bottom:1px solid #536c83}
#session-status p,#session-status form{margin:4px 0}#timeline{max-height:700px;overflow:auto}#timeline button{white-space:pre-wrap}
details{margin:10px 0}summary{cursor:pointer;color:#afd3f7}
main{display:grid;grid-template-columns:minmax(340px,1fr) minmax(460px,1.4fr);gap:16px;padding:16px}
section{padding:16px;border:1px solid #35475a;border-radius:6px;min-width:0;background:#141f2b}
#comparison-panel{grid-column:1/-1}nav{display:flex;gap:8px;align-items:center;margin:10px 0}
.row{display:block;text-align:left;width:100%;margin:3px 0;overflow-wrap:anywhere}.row.selected{border-color:#79d0ff;background:#284962}
.row small{display:block;color:#b7c6d4}.muted{color:#afbbc6}.tag{padding:2px 5px;background:#30455a;border-radius:3px}
.fields{width:100%;border-collapse:collapse;table-layout:fixed}.fields th,.fields td{border-bottom:1px solid #34475a;padding:6px;vertical-align:top;text-align:left;overflow-wrap:anywhere}
.fields th{width:27%}.ref-link{color:#94d5ff;text-align:left;overflow-wrap:anywhere;font-size:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;max-height:350px;overflow:auto}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px}.ref-key{color:#bed1e4}.read-key{color:#75c6ff}.return-key{color:#f0b757}
#graph{overflow:auto;min-height:180px;border:1px solid #34475a;background:#111c28;border-radius:5px}
svg{display:block;width:100%;min-width:480px}svg .edge{stroke:#8ba2b8;stroke-width:1.5;opacity:.65}
svg .observed-read{stroke:#75c6ff;stroke-dasharray:6 4}svg .observed-return{stroke:#f0b757;stroke-dasharray:3 4}
svg .node rect{fill:#22374b;stroke:#7d9cb5}svg .node.root rect{fill:#274c68;stroke:#91d4ff;stroke-width:2}
svg .node.unknown rect{fill:#352f2b;stroke:#dbbd80}svg .node{cursor:pointer}svg text{fill:#e4eaf0;font:11px system-ui;pointer-events:none}
svg .node:hover rect,svg .node:focus rect{fill:#355878;stroke:white}svg .edge-label{font-size:9px;fill:#aec1d1}
.sides{display:grid;grid-template-columns:1fr 1fr;gap:12px}.side{padding:12px;border:1px solid #455d72;min-width:0}
.boundary{display:block;margin:5px 0}.history-future{opacity:.7}.changes{overflow:auto}.changes table{min-width:800px}
@media(max-width:980px){main{grid-template-columns:1fr}.sides{grid-template-columns:1fr}header{padding:12px}}
`;
