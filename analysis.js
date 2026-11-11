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
    onChange: null,
    pointId: null,
    metric: "3d",
    targets: new Map(),
    page: 0,
    group: null,
    analysis: null,
  };
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  const number = (value) =>
    value === null || value === undefined ? "—" : value.toFixed(6);
  function message(text = "") {
    $("analysis-message").textContent = text;
  }
  function redraw() {
    render(state.points, { busy: state.busy, onChange: state.onChange });
  }
  function changed() {
    if (state.onChange) state.onChange();
    else redraw();
  }

  function render(points, { busy = false, onChange = null } = {}) {
    state.points = points;
    state.busy = busy;
    state.onChange = onChange;
    const groups = C.groupMeasurements(points).sort((a, b) =>
      a.pointId.localeCompare(b.pointId, "en", { numeric: true }),
    );
    const available = new Set(groups.map((group) => group.pointId));
    for (const id of state.targets.keys())
      if (!available.has(id)) state.targets.delete(id);
    if (!available.has(state.pointId)) {
      state.pointId = groups[0]?.pointId ?? null;
      state.page = 0;
      message();
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
    state.group = group || null;
    const analysis = C.measurementAnalysis(
      group?.measurements || [],
      state.metric,
    );
    state.analysis = analysis;
    const complete =
      analysis.count > 0 && analysis.convertedCount === analysis.count;
    const minimum = Math.min(2, analysis.count);
    const target = state.targets.has(state.pointId)
      ? state.targets.get(state.pointId)
      : String(Math.max(minimum, Math.ceil(analysis.count * 0.9)));
    $("analysis-keep-count").value = target;
    $("analysis-keep-count").min = String(minimum || 1);
    $("analysis-keep-count").max = String(analysis.count);
    $("analysis-keep-count").disabled = busy || !complete;
    $("analysis-metric").disabled = busy || !analysis.convertedCount;
    const valid =
      target !== "" &&
      Number.isInteger(Number(target)) &&
      Number(target) >= minimum &&
      Number(target) <= analysis.count;
    $("analysis-keep-count").setAttribute(
      "aria-invalid",
      String(complete && !valid),
    );
    $("analysis-preselect").disabled = busy || !complete || !valid;
    $("analysis-preselect").textContent =
      complete && valid
        ? `Preselect top ${analysis.count - Number(target)} outlier${analysis.count - Number(target) === 1 ? "" : "s"}`
        : "Preselect outliers";
    $("analysis-restore").disabled = busy || !analysis.excludedCount;
    $("analysis-sheet-button").disabled =
      busy || !complete || !analysis.retainedCount;
    $("analysis-summary").textContent = group
      ? `${group.pointId}: ${analysis.count} imported · ${analysis.convertedCount} converted · ${analysis.retainedCount} retained · ${analysis.excludedCount} excluded.${complete ? " Retained readings determine this point’s CAD mean." : " Convert all readings for this point before selecting exclusions or exporting its mean."}`
      : "Import and convert receiver measurements to analyze their spread. Pasted grid points are map-only.";
    $("analysis-statistics-body").replaceChildren(
      ...[
        ["hkE", "Easting (m)"],
        ["hkN", "Northing (m)"],
        ["hkpd", "Height (mPD)"],
      ].map(([key, label]) => {
        const row = node("tr"),
          all = analysis.baselineStatistics?.[key],
          kept = analysis.retainedStatistics?.[key];
        row.append(
          ...[
            label,
            number(all?.mean),
            number(all?.sampleSd),
            number(kept?.mean),
            number(kept?.sampleSd),
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
      const point = entry.point,
        excluded = point.excludedFromMean === true;
      const row = node("tr", undefined, excluded ? "analysis-excluded" : "");
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
      const removal = node("td"),
        label = node("label", undefined, "analysis-removal-label"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = excluded;
      checkbox.dataset.readingIndex = String(entry.index);
      checkbox.setAttribute(
        "aria-label",
        `Remove ${point.name}, ${point.source || "reading"}${point.line ? ` line ${point.line}` : ""}, from mean`,
      );
      checkbox.disabled =
        busy || !complete || (!excluded && analysis.retainedCount <= minimum);
      label.append(checkbox, node("span", excluded ? "Excluded" : "Keep"));
      removal.append(label);
      row.append(removal);
      body.append(row);
    }
    if (!analysis.rows.length) {
      const row = node("tr"),
        cell = node(
          "td",
          "Converted readings for the selected point will appear here, ranked by departure from the original group mean.",
        );
      cell.colSpan = 7;
      row.append(cell);
      body.append(row);
    }
    $("analysis-previous").disabled = busy || state.page === 0;
    $("analysis-next").disabled = busy || state.page >= pages - 1;
    $("analysis-page-label").textContent = `Page ${state.page + 1} of ${pages}`;
    $("analysis-caption").textContent = analysis.rows.length
      ? `Showing ${state.page * PAGE_SIZE + 1}–${Math.min((state.page + 1) * PAGE_SIZE, analysis.rows.length)} of ${analysis.rows.length} readings · ${labels[state.metric]} departures, largest first · selections include every page`
      : "No converted readings";
  }

  $("analysis-point").addEventListener("change", (event) => {
    state.pointId = event.target.value;
    state.page = 0;
    message();
    redraw();
  });
  $("analysis-metric").addEventListener("change", (event) => {
    state.metric = event.target.value;
    state.page = 0;
    message(
      "Ranking changed. Existing exclusions stay selected until you preselect again or edit the checkboxes.",
    );
    redraw();
  });
  $("analysis-keep-count").addEventListener("input", (event) => {
    state.targets.set(state.pointId, event.target.value);
    message();
    redraw();
  });
  $("analysis-preselect").addEventListener("click", () => {
    if (state.busy || !state.group) return;
    try {
      const excluded = new Set(
        C.suggestExclusions(
          state.group.measurements,
          Number($("analysis-keep-count").value),
          state.metric,
        ),
      );
      for (const point of state.group.measurements) {
        point.excludedFromMean = excluded.has(point);
        point.exclusionReason = point.excludedFromMean
          ? `Preselected ${labels[state.metric]} outlier from original group mean`
          : "";
      }
      state.page = 0;
      const ranked = state.analysis.rows;
      const tied =
        excluded.size > 0 &&
        ranked[excluded.size] &&
        Math.abs(
          ranked[excluded.size - 1].score - ranked[excluded.size].score,
        ) < 1e-12;
      message(
        `${excluded.size} readings preselected for exclusion in ${state.group.pointId}. Review the highlighted rows and tick or untick to adjust.${tied ? " Departures are tied at the cutoff; equal scores use import order." : ""}`,
      );
      changed();
    } catch (error) {
      message(error.message);
    }
  });
  $("analysis-restore").addEventListener("click", () => {
    if (state.busy || !state.group) return;
    for (const point of state.group.measurements) {
      point.excludedFromMean = false;
      point.exclusionReason = "";
    }
    message(`All readings restored for ${state.group.pointId}.`);
    changed();
  });
  $("analysis-readings-body").addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-reading-index]");
    if (!checkbox || state.busy || !state.group) return;
    const analysis = C.measurementAnalysis(
      state.group.measurements,
      state.metric,
    );
    const point =
      state.group.measurements[Number(checkbox.dataset.readingIndex)];
    if (!point || analysis.count !== analysis.convertedCount) return;
    if (
      checkbox.checked &&
      !point.excludedFromMean &&
      analysis.retainedCount <= Math.min(2, analysis.count)
    ) {
      checkbox.checked = false;
      message(
        "Keep at least two readings when available so sample SD remains meaningful.",
      );
      return;
    }
    point.excludedFromMean = checkbox.checked;
    point.exclusionReason = checkbox.checked
      ? "Manually excluded in data analysis"
      : "";
    message(
      `${point.name} ${checkbox.checked ? "excluded from" : "restored to"} the mean for ${state.group.pointId}.`,
    );
    changed();
    $("analysis-readings-body")
      .querySelector(
        `input[data-reading-index="${Number(checkbox.dataset.readingIndex)}"]`,
      )
      ?.focus({ preventScroll: true });
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
