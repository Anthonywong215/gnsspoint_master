"use strict";
(() => {
  const C = window.GnssConverter;
  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 50;
  const labels = {
    "3d": "3D",
    horizontal: "horizontal",
    height: "height",
    easting: "easting",
    northing: "northing",
  };
  const state = {
    points: [],
    busy: false,
    pointId: null,
    metric: "3d",
    page: 0,
  };
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  const number = (value) =>
    value === null || value === undefined ? "—" : value.toFixed(6);
  function redraw() {
    render(state.points, { busy: state.busy });
  }


  const axes = [
    ["hkE", "Easting"],
    ["hkN", "Northing"],
    ["hkpd", "Height"],
  ];

  function graphic(tag, attributes, label) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, value);
    if (label !== undefined) element.textContent = label;
    return element;
  }

  function renderCharts(rankedRows, groupCount) {
    const container = $("analysis-chart-grid");
    $("analysis-charts").hidden = !rankedRows.length;
    container.replaceChildren();
    if (!rankedRows.length) return;

    const rows = [...rankedRows].sort((a, b) => a.index - b.index);
    let horizontalLimit = 0.001;
    let profileLimit = horizontalLimit;
    for (const { residuals } of rows) {
      horizontalLimit = Math.max(horizontalLimit, Math.abs(residuals.hkE) * 1.08, Math.abs(residuals.hkN) * 1.08);
      profileLimit = Math.max(profileLimit, horizontalLimit, Math.abs(residuals.hkpd) * 1.08);
    }

    const plots = [
      { title: "Plan spread", xKey: "hkE", yKey: "hkN", limit: horizontalLimit },
      ...axes.map(([yKey, label]) => ({
        title: label + " profile", yKey, limit: profileLimit,
      })),
    ];
    for (const { title, xKey, yKey, limit } of plots) {
      const plot = node("figure", undefined, "analysis-chart");
      const svg = graphic("svg", {
        viewBox: "0 0 310 224",
        role: "img",
        "aria-label": title + " for " + rows.length + " converted readings",
      });
      const left = xKey ? 100 : 64;
      const width = xKey ? 154 : 224;
      const top = 16;
      const height = 154;
      const bottom = top + height;
      const midY = top + height / 2;
      const indexSpan = Math.max(1, groupCount - 1);
      const y = (row) => midY - row.residuals[yKey] / limit * (height / 2);
      const x = xKey
        ? (row) => left + width / 2 + row.residuals[xKey] / limit * (width / 2)
        : (row) => left + 5 + row.index / indexSpan * (width - 10);
      const axisText = (x, y, label, anchor = "middle") =>
        graphic("text", { x, y, "text-anchor": anchor }, label);
      const tick = (value) => Number(value.toPrecision(3)).toString();
      svg.append(
        graphic("rect", { x: left, y: top, width, height, class: "chart-frame" }),
        graphic("line", { x1: left, x2: left + width, y1: midY, y2: midY, class: "chart-zero" }),
        axisText(left - 6, top + 9, tick(limit), "end"),
        axisText(left - 6, midY + 4, "0", "end"),
        axisText(left - 6, bottom - 1, tick(-limit), "end"),
        axisText(left - 6, top - 4, xKey ? "ΔN (m)" : "Δ (m)", "end"),
        axisText(left + width / 2, bottom + 39, xKey ? "ΔE (m)" : "Reading in import order"),
      );
      if (xKey) {
        const midX = left + width / 2;
        svg.append(
          graphic("line", { x1: midX, x2: midX, y1: top, y2: bottom, class: "chart-zero" }),
          axisText(left, bottom + 17, tick(-limit)),
          axisText(midX, bottom + 17, "0"),
          axisText(left + width, bottom + 17, tick(limit)),
        );
      } else {
        svg.append(axisText(left + 5, bottom + 17, "1"));
        if (groupCount > 1)
          svg.append(axisText(left + width - 5, bottom + 17, String(groupCount)));
        let path = "";
        let previousIndex = -2;
        for (const row of rows) {
          path += (row.index === previousIndex + 1 ? " L " : " M ") + x(row) + " " + y(row);
          previousIndex = row.index;
        }
        svg.append(graphic("path", { d: path, class: "chart-profile" }));
      }
      for (const row of rows) {
        const { point, residuals, index } = row;
        const dot = graphic("circle", { cx: x(row), cy: y(row), r: 3.5, class: "chart-dot" });
        const values = (xKey ? ["hkE", "hkN"] : [yKey])
          .map((key) => axes.find(([axis]) => key === axis)[1] + " " + number(residuals[key]) + " m");
        const source = [point.source, point.line && "line " + point.line].filter(Boolean).join(", ");
        dot.append(graphic("title", {}, "#" + (index + 1) + " " + point.name +
          (source ? " (" + source + ")" : "") + " · " + values.join(", ")));
        svg.append(dot);
      }
      plot.append(node("figcaption", title), svg);
      container.append(plot);
    }
  }

  function render(points, { busy = false } = {}) {
    state.points = points;
    state.busy = busy;
    const groups = C.groupMeasurements(points).sort((a, b) =>
      a.pointId.localeCompare(b.pointId, "en", { numeric: true }),
    );
    const available = new Set(groups.map((group) => group.pointId));
    if (!available.has(state.pointId)) {
      state.pointId = groups[0]?.pointId ?? null;
      state.page = 0;
    }
    $("analysis-point").replaceChildren(
      ...groups.map((group) => {
        const option = node(
          "option",
          `${group.pointId} · ${group.count} readings`,
        );
        option.value = group.pointId;
        return option;
      }),
    );
    if (state.pointId !== null) $("analysis-point").value = state.pointId;
    $("analysis-point").disabled = busy || !groups.length;
    const group = groups.find(
      (candidate) => candidate.pointId === state.pointId,
    );
    const analysis = C.measurementAnalysis(
      group?.measurements || [],
      state.metric,
    );
    const complete =
      analysis.count > 0 && analysis.convertedCount === analysis.count;
    $("analysis-metric").disabled = busy || !analysis.convertedCount;
    $("analysis-sheet-button").disabled = busy || !complete;
    $("analysis-summary").textContent = group
      ? `${group.pointId}: ${analysis.convertedCount} of ${analysis.count} readings converted. ${complete ? "All readings contribute to the CAD mean." : "The plots show converted readings so far. The CAD mean requires all readings to convert."}`
      : "Import and convert receiver measurements to analyze their spread. Pasted grid points are map-only.";
    renderCharts(analysis.rows, analysis.count);
    $("analysis-statistics-body").replaceChildren(
      ...[
        ["hkE", "Easting (m)"],
        ["hkN", "Northing (m)"],
        ["hkpd", "Height (mPD)"],
      ].map(([key, label]) => {
        const row = node("tr"), all = analysis.baselineStatistics?.[key];
        row.append(
          ...[
            label,
            number(all?.mean),
            number(all?.sampleSd),
          ].map((text) => node("td", text)),
        );
        row.dataset.coordinate = key;
        return row;
      }),
    );
    const pages = Math.max(1, Math.ceil(analysis.rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const body = $("analysis-readings-body");
    body.replaceChildren();
    for (const entry of analysis.rows.slice(
      state.page * PAGE_SIZE,
      (state.page + 1) * PAGE_SIZE,
    )) {
      const point = entry.point;
      const row = node("tr");
      row.dataset.recordId = point.recordId || "";
      row.dataset.rank = String(entry.rank);
      row.append(node("td", entry.rank));
      const name = node("td");
      name.append(
        node("strong", point.name),
        node(
          "span",
          `${point.source || ""}${point.line ? ` · line ${point.line}` : ""}`,
          "source-name",
        ),
      );
      if (point.collectedAt)
        name.append(
          node(
            "span",
            [point.collectedAt.date, point.collectedAt.time]
              .filter(Boolean)
              .join(" "),
            "source-name",
          ),
        );
      row.append(name);
      for (const key of ["hkE", "hkN", "hkpd"]) {
        const value = node("td", point.result[key].toFixed(3));
        const delta = entry.residuals[key];
        value.append(
          node(
            "span",
            `Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(6)}`,
            "source-name",
          ),
        );
        row.append(value);
      }
      row.append(node("td", entry.score.toFixed(6)));
      body.append(row);
    }
    if (!analysis.rows.length) {
      const row = node("tr"),
        cell = node(
          "td",
          "Converted readings for the selected point will appear here, ranked by departure from the original group mean.",
        );
      cell.colSpan = 6;
      row.append(cell);
      body.append(row);
    }
    $("analysis-previous").disabled = busy || state.page === 0;
    $("analysis-next").disabled = busy || state.page >= pages - 1;
    $("analysis-page-label").textContent = `Page ${state.page + 1} of ${pages}`;
    $("analysis-caption").textContent = analysis.rows.length
      ? `Showing ${state.page * PAGE_SIZE + 1}–${Math.min((state.page + 1) * PAGE_SIZE, analysis.rows.length)} of ${analysis.rows.length} readings · ${labels[state.metric]} departures, largest first · all converted readings are plotted`
      : "No converted readings";
  }

  $("analysis-point").addEventListener("change", (event) => {
    state.pointId = event.target.value;
    state.page = 0;
    redraw();
  });
  $("analysis-metric").addEventListener("change", (event) => {
    state.metric = event.target.value;
    state.page = 0;
    redraw();
  });
  $("analysis-previous").addEventListener("click", () => {
    if (state.page > 0) state.page--;
    redraw();
  });
  $("analysis-next").addEventListener("click", () => {
    state.page++;
    redraw();
  });
  window.GnssAnalysis = { render };
})();
