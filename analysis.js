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


  const referenceOffsets = { hkE: 0.010, hkN: 0.010, hkpd: 0.020 };

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

  function sortedGroups(points) {
    return C.groupMeasurements(points).sort((a, b) =>
      a.pointId.localeCompare(b.pointId, 'en', { numeric: true }),
    );
  }

  function exceedsGuide(residuals, key) {
    // Allow for floating-point rounding when subtracting HK1980 coordinates.
    return Math.abs(residuals[key]) - referenceOffsets[key] > 1e-9;
  }

  function buildCharts(rankedRows, groupCount) {
    if (!rankedRows.length) return [];

    const rows = [...rankedRows].sort((a, b) => a.index - b.index);
    let horizontalLimit = referenceOffsets.hkE * 1.25;
    let profileLimit = referenceOffsets.hkpd * 1.25;
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
    return plots.map(({ title, xKey, yKey, limit }) => {
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
      const offsetY = (value) => midY - value / limit * (height / 2);
      const offsetX = (value) => left + width / 2 + value / limit * (width / 2);
      const y = (row) => offsetY(row.residuals[yKey]);
      const x = xKey
        ? (row) => offsetX(row.residuals[xKey])
        : (row) => left + 5 + row.index / indexSpan * (width - 10);
      const axisText = (x, y, label, anchor = "middle") =>
        graphic("text", { x, y, "text-anchor": anchor }, label);
      const tick = (value) => Number((value * 1000).toPrecision(3)).toString();
      svg.append(
        graphic("rect", { x: left, y: top, width, height, class: "chart-frame" }),
        graphic("line", { x1: left, x2: left + width, y1: midY, y2: midY, class: "chart-zero" }),
        axisText(left - 6, top + 9, tick(limit), "end"),
        axisText(left - 6, midY + 4, "0", "end"),
        axisText(left - 6, bottom - 1, tick(-limit), "end"),
        axisText(left - 6, top - 4, xKey ? "ΔN (mm)" : "Δ (mm)", "end"),
        axisText(left + width / 2, bottom + 39, xKey ? "ΔE (mm)" : "Reading in import order"),
      );
      for (const sign of [-1, 1]) {
        const guideY = offsetY(sign * referenceOffsets[yKey]);
        svg.append(graphic("line", {
          x1: left, x2: left + width, y1: guideY, y2: guideY, class: "chart-reference",
        }));
        if (xKey) {
          const guideX = offsetX(sign * referenceOffsets[xKey]);
          svg.append(graphic("line", {
            x1: guideX, x2: guideX, y1: top, y2: bottom, class: "chart-reference",
          }));
        }
      }
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
      const plottedAxes = xKey ? [xKey, yKey] : [yKey];
      const highlighted = [];
      for (const row of rows) {
        const { point, residuals, index } = row;
        const beyondGuide = plottedAxes.some((key) => exceedsGuide(residuals, key));
        const dot = graphic("circle", { cx: x(row), cy: y(row), r: 3.5, class: beyondGuide ? "chart-dot chart-dot-beyond" : "chart-dot" });
        const values = plottedAxes
          .map((key) => axes.find(([axis]) => key === axis)[1] + " " + (residuals[key] * 1000).toFixed(3) + " mm");
        const source = [point.source, point.line && "line " + point.line].filter(Boolean).join(", ");
        dot.append(graphic("title", {}, "#" + (index + 1) + " " + point.name +
          (source ? " (" + source + ")" : "") + " · " + values.join(", ") +
          (beyondGuide ? " (beyond reference)" : "")));
        if (beyondGuide) highlighted.push(dot);
        else svg.append(dot);
      }
      for (const dot of highlighted) svg.append(dot);
      plot.append(node("figcaption", title), svg);
      return plot;
    });
  }


  async function chartsPng() {

    const points = state.points;
    const groups = sortedGroups(points);
    const width = 1280;
    const headerHeight = 82;
    const rowHeight = 272;
    const height = headerHeight + groups.length * rowHeight;
    const scale = Math.min(2, 32767 / height, Math.sqrt(64000000 / (width * height)));
    if (scale < 0.75)
      throw new Error("This report is too tall for one readable PNG. Import fewer point IDs and try again.");
    const report = graphic("svg", { width, height, viewBox: [0, 0, width, height].join(" ") });
    const style = graphic("style", {}, `
      text { fill: #172536; font-family: Arial, sans-serif; font-size: 11px; }
      .chart-frame, .chart-zero, .chart-profile, .chart-reference { fill: none; }
      .chart-frame { stroke: #c7d0da; }
      .chart-zero { stroke: #788595; stroke-dasharray: 4 3; }
      .chart-profile { stroke: #788595; }
      .chart-reference { stroke: #a97700; stroke-dasharray: 5 3; }
      .chart-dot { fill: #2981be; stroke: #172536; stroke-width: 0.5; }
      .chart-dot-beyond { fill: #ffcf33; }
    `);

    report.append(
      style,
      graphic("rect", { width, height, fill: "#ffffff" }),
      graphic("text", { x: 20, y: 30, style: "font-size: 22px; font-weight: bold" },
        "GNSS repeatability | " + groups.length + " point IDs"),
      graphic("text", { x: 20, y: 52, style: "font-size: 13px" },
        "Offsets from each point mean. Yellow exceeds the reference: Easting/Northing ±10 mm, height ±20 mm."),
      graphic("text", { x: 20, y: 70, style: "font-size: 13px" },
        "Compare with independent survey control to check for a shift shared by the whole set."),
    );
    groups.forEach((group, i) => {
      const top = headerHeight + i * rowHeight;
      const analysis = C.measurementAnalysis(group.measurements);
      const counts = axes.map(([key, label]) =>
        label + " " + analysis.rows.filter(({ residuals }) => exceedsGuide(residuals, key)).length,
      );
      const pointLabel = graphic("text", { x: 20, y: top + 24, style: "font-size: 16px; font-weight: bold" }, group.pointId);
      if (group.pointId.length > 70) {
        pointLabel.setAttribute("textLength", "700");
        pointLabel.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
      report.append(
        graphic("rect", { x: 0, y: top, width, height: rowHeight, fill: i % 2 ? "#f5f8fb" : "#ffffff" }),
        graphic("line", { x1: 20, x2: 1260, y1: top, y2: top, stroke: "#c7d0da" }),
        pointLabel,
        graphic("text", { x: 1260, y: top + 24, "text-anchor": "end", style: "font-size: 12px" },
          analysis.convertedCount + "/" + analysis.count + " converted" +
            (analysis.convertedCount ? " | Beyond guide: " + counts.join(", ") : " | No converted readings")),
      );
      buildCharts(analysis.rows, analysis.count).forEach((figure, column) => {
        const left = 20 + column * 310;
        const chart = figure.querySelector("svg");
        chart.setAttribute("x", left);
        chart.setAttribute("y", top + 46);
        chart.setAttribute("width", "310");
        chart.setAttribute("height", "224");
        report.append(
          graphic("text", { x: left + 2, y: top + 44, style: "font-size: 13px; font-weight: bold" },
            figure.querySelector("figcaption").textContent),
          chart,
        );
      });
    });

    const source = new Blob([new XMLSerializer().serializeToString(report)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(source);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode the chart image.");
      return { blob, filename: C.exportFilename(points, "converted", "png", "charts") };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function render(points, { busy = false } = {}) {
    state.points = points;
    state.busy = busy;
    const groups = sortedGroups(points);
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
    $("analysis-charts-button").disabled = busy || !points.some((point) => point.result);
    $("analysis-metric").disabled = busy || !analysis.convertedCount;
    $("analysis-sheet-button").disabled = busy || !complete;
    $("analysis-summary").textContent = group
      ? `${group.pointId}: ${analysis.convertedCount} of ${analysis.count} readings converted. ${complete ? "All readings contribute to the CAD mean." : "The plots show converted readings so far. The CAD mean requires all readings to convert."}`
      : "Import and convert receiver measurements to analyze their spread. Pasted grid points are map-only.";
    $("analysis-charts").hidden = !analysis.rows.length;
    $("analysis-chart-grid").replaceChildren(...buildCharts(analysis.rows, analysis.count));
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
            `Δ ${delta >= 0 ? "+" : ""}${(delta * 1000).toFixed(3)} mm`,
            "source-name",
          ),
        );
        row.append(value);
      }
      row.append(node("td", (entry.score * 1000).toFixed(3)));
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
  window.GnssAnalysis = { render, chartsPng };
})();
