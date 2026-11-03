"use strict";
(() => {
  const C = window.GnssConverter;
  const $ = (id) => document.getElementById(id);
  const state = {
    points: [],
    gridPoints: [],
    gridLoading: false,
    gridController: null,
    files: [],
    issues: [],
    page: 0,
    importing: false,
    converting: false,
    controller: null,
    outputOrder: "EN",
    view: "grouped",
    expanded: new Set(),
  };
  const PAGE_SIZE = 50;
  const ui = Object.fromEntries(
    [
      "file-input",
      "drop-zone",
      "file-list",
      "example-button",
      "clear-button",
      "convert-button",
      "stop-button",
      "prepared-button",
      "results-button",
      "measurements-button",
      "statistics-button",
      "coordinate-button",
      "json-button",
      "previous-button",
      "next-button",
    ].map((id) => [id, $(id)]),
  );
  let dragDepth = 0;
  const formatLabels = {
    decimal: "decimal degrees",
    dms: "DMS → decimal",
    packed: "packed DMS → decimal",
    mixed: "mixed angles → decimal",
  };
  function describeFormats(counts) {
    return Object.entries(counts)
      .filter(([, count]) => count)
      .map(
        ([format, count]) =>
          `${count.toLocaleString()} ${formatLabels[format]}`,
      )
      .join(" · ");
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function announce(message, error = false) {
    $("notice").textContent = message;
    $("notice").className = error ? "notice error" : "notice";
    $("notice").hidden = !message;
  }
  function newMeasurement(point) {
    return {
      ...point,
      ...C.pointIdentity(point.name),
      recordId: crypto.randomUUID(),
      status: "ready",
    };
  }
  function appendGroup(fragment, group, keys) {
    const expanded = state.expanded.has(group.pointId);
    const row = element("tr", undefined, "group-row");
    row.dataset.pointId = group.pointId;
    const name = element("td"),
      toggle = element(
        "button",
        `${expanded ? "▾" : "▸"} ${group.pointId}`,
        "group-toggle",
      );
    toggle.type = "button";
    toggle.dataset.togglePoint = group.pointId;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} ${group.pointId}, ${group.count} measurements`,
    );
    name.append(
      toggle,
      element(
        "span",
        `${group.count.toLocaleString()} measurements`,
        "source-name",
      ),
    );
    const info = element("td");
    info.colSpan = 3;
    const sources = new Set(group.measurements.map((point) => point.source));
    info.append(
      element(
        "span",
        `${sources.size} source file${sources.size === 1 ? "" : "s"}`,
        "group-source",
      ),
      element(
        "span",
        group.convertedCount
          ? `Mean of ${group.convertedCount} / ${group.count} converted measurements`
          : "Expand to review individual measurements",
        "source-name",
      ),
    );
    row.append(name, info);
    for (const key of keys)
      row.append(
        element(
          "td",
          group.statistics ? group.statistics[key].mean.toFixed(3) : "—",
          "result-col group-mean",
        ),
      );
    const status = element("td");
    const active = group.measurements.some(
      (point) => point.status === "converting",
    );
    status.append(
      element(
        "span",
        active
          ? "Converting…"
          : group.convertedCount === group.count
            ? "All converted"
            : group.convertedCount
              ? `${group.convertedCount} / ${group.count} converted`
              : group.errorCount
                ? `${group.errorCount} failed`
                : "Ready",
        `badge ${group.convertedCount === group.count ? "done" : group.errorCount ? "error" : ""}`,
      ),
    );
    row.append(status, element("td", "Group mean", "group-source"));
    fragment.append(row);
    if (!expanded) return;
    const details = element("tr", undefined, "group-details"),
      cell = element("td");
    cell.colSpan = 9;
    if (!group.statistics)
      cell.append(
        element(
          "span",
          "Convert these measurements to see their mean, sample standard deviation and range.",
        ),
      );
    else {
      cell.append(
        element(
          "p",
          `${group.pointId}: ${group.convertedCount} of ${group.count} measurements used. Sample SD describes measurement spread; at least two converted measurements are needed.`,
          "stats-caption",
        ),
      );
      const grid = element("div", undefined, "group-statistics");
      for (const key of keys) {
        const stats = group.statistics[key],
          card = element("div");
        card.append(
          element("strong", `${key} · ${key === "hkpd" ? "mPD" : "m"}`),
          element(
            "span",
            `Mean ${stats.mean.toFixed(6)} · SD ${stats.sampleSd === null ? "—" : stats.sampleSd.toFixed(6)}`,
          ),
          element(
            "span",
            `Min ${stats.min.toFixed(3)} · Max ${stats.max.toFixed(3)} · Range ${stats.range.toFixed(6)}`,
          ),
        );
        grid.append(card);
      }
      cell.append(grid);
    }
    details.append(cell);
    fragment.append(details);
  }
  function render() {
    window.GnssMap?.update([...state.points, ...state.gridPoints]);
    const busy = state.importing || state.converting;
    $("grid-load-button").disabled = busy;
    $("grid-clear-button").disabled = busy;
    $("grid-input").disabled = busy;
    $("grid-stop-button").hidden = !state.gridLoading;
    const total = state.points.length;
    const groups = C.groupMeasurements(state.points);
    const grouped = state.view === "grouped";
    const entries = grouped ? groups : state.points;
    $("points-body").closest("table").querySelector("th").textContent = grouped
      ? "Point ID / measurement"
      : "Measurement name";
    const done = state.points.filter((p) => p.result).length;
    const pending = state.points.filter((p) => !p.result).length;
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    $("point-count").textContent = total.toLocaleString();
    $("unique-point-count").textContent = groups.length.toLocaleString();
    $("ready-count").textContent = pending.toLocaleString();
    $("converted-count").textContent = done.toLocaleString();
    ui["file-input"].disabled = busy;
    $("angle-format").disabled = busy;
    ui["drop-zone"].setAttribute("aria-disabled", String(busy));
    ui["drop-zone"].tabIndex = busy ? -1 : 0;
    ui["example-button"].disabled = busy;
    ui["clear-button"].disabled =
      busy || !(total || state.files.length || state.issues.length);
    ui["convert-button"].disabled = busy || pending === 0;
    ui["convert-button"].textContent = state.converting
      ? "Converting…"
      : done && pending
        ? "Convert remaining ↗"
        : "Convert with LandsD ↗";
    ui["stop-button"].hidden = !state.converting;
    ui["prepared-button"].disabled = busy || !total;
    const means = C.meanCoordinates(state.points);
    ui["results-button"].disabled = busy || !means.length;
    ui["measurements-button"].disabled = busy || !done;
    ui["statistics-button"].disabled = busy || !done;
    ui["coordinate-button"].disabled = busy || !means.length;
    ui["coordinate-button"].textContent =
      state.outputOrder === "EN" ? "↓ TXYZ TXT" : "↓ TYXZ TXT";
    ui["json-button"].disabled = busy || !done;
    const outputKeys = C.outputKeys(state.outputOrder);
    $("output-first-heading").replaceChildren(
      document.createTextNode(outputKeys[0] + " "),
      element("small", "HK80 m"),
    );
    $("output-second-heading").replaceChildren(
      document.createTextNode(outputKeys[1] + " "),
      element("small", "HK80 m"),
    );
    const outputLabels = {
      hkN: "HK80 northing · m",
      hkE: "HK80 easting · m",
      hkpd: "HK height · mPD",
    };
    $("output-tags").replaceChildren(
      ...outputKeys.map((key) => {
        const tag = element("span", key + " ");
        tag.append(element("small", outputLabels[key]));
        return tag;
      }),
    );
    $("output-order-note").textContent =
      `Mean results use ${state.outputOrder === "EN" ? "ID, Easting, Northing, mPD (TXYZ)" : "ID, Northing, Easting, mPD (TYXZ)"}. Each unique point contributes one mean after all its measurements convert. Measurement details remain available separately.`;
    $("mean-first-heading").textContent =
      state.outputOrder === "EN" ? "Easting" : "Northing";
    $("mean-second-heading").textContent =
      state.outputOrder === "EN" ? "Northing" : "Easting";
    $("mean-export-summary").textContent =
      `${means.length.toLocaleString()} of ${groups.length.toLocaleString()} unique point means ready. ${groups.length - means.length} point(s) still have unconverted or failed measurements. CSV has four columns; coordinate.txt has the same values without a header. Means are in metres, to 3 decimal places.`;
    const meanBody = $("mean-results-body");
    meanBody.replaceChildren();
    for (const point of means.slice(0, 10)) {
      const row = element("tr");
      row.append(
        element("td", point.pointId),
        ...C.outputKeys(state.outputOrder).map((key) =>
          element("td", point[key].toFixed(3)),
        ),
      );
      meanBody.append(row);
    }
    if (!means.length) {
      const row = element("tr"),
        cell = element(
          "td",
          "Convert all measurements for a point to prepare its mean coordinates.",
        );
      cell.colSpan = 4;
      row.append(cell);
      meanBody.append(row);
    }
    $("mean-export-caption").textContent =
      means.length > 10
        ? `Showing the first 10 means; downloads include all ${means.length}.`
        : `${means.length} unique mean-coordinate row(s).`;
    $("expand-groups-button").disabled = !groups.length || !grouped;
    $("collapse-groups-button").disabled = !state.expanded.size || !grouped;
    ui["previous-button"].disabled = state.page === 0;
    ui["next-button"].disabled = state.page >= pages - 1;
    $("page-label").textContent = `Page ${state.page + 1} of ${pages}`;
    $("table-caption").textContent = total
      ? `Showing ${state.page * PAGE_SIZE + 1}–${Math.min(entries.length, (state.page + 1) * PAGE_SIZE)} of ${entries.length.toLocaleString()} ${grouped ? "unique points" : "measurements"} · ${total.toLocaleString()} measurements retained in Measurements CSV / JSON`
      : "No files loaded";

    $("file-list").replaceChildren(
      ...state.files.map((file) => {
        const li = element("li");
        const details = element("div", undefined, "file-meta");
        details.append(
          element(
            "div",
            `${file.profile} · ${file.uniqueCount} unique points · ${file.count} measurements · ${describeFormats(file.formatCounts)}${file.rejected ? ` · ${file.rejected} rejected` : ""}`,
          ),
          element("div", file.fieldMapping),
        );
        li.append(element("span", file.name, "filename"), details);
        return li;
      }),
    );
    $("format-summary").hidden = !state.files.length;
    $("format-summary").textContent = state.files.length
      ? "All accepted coordinates are shown and sent as decimal degrees. DMS originals are retained in result downloads."
      : "";
    $("issues-panel").hidden = !state.issues.length;
    $("issues-summary").textContent =
      `${state.issues.length} import issue${state.issues.length === 1 ? "" : "s"} · review skipped rows`;
    const issueNodes = state.issues
      .slice(0, 200)
      .map((issue) =>
        element(
          "li",
          `${issue.source}${issue.line ? `, line ${issue.line}` : ""}${issue.name ? ` (${issue.name})` : ""}: ${issue.message}`,
        ),
      );
    if (state.issues.length > 200)
      issueNodes.push(
        element(
          "li",
          `${state.issues.length - 200} more issues. Import fewer files to inspect them individually.`,
        ),
      );
    $("issues-list").replaceChildren(...issueNodes);

    const body = $("points-body");
    body.replaceChildren();
    if (!total) {
      const row = element("tr"),
        cell = element("td"),
        empty = element("div", undefined, "empty-state");
      cell.colSpan = 9;
      empty.append(
        element("span", "＋", "empty-cross"),
        element("strong", "Your points will appear here"),
        element(
          "span",
          "Import an export or load the manual example to get started.",
        ),
      );
      cell.append(empty);
      row.append(cell);
      body.append(row);
      return;
    }
    const fragment = document.createDocumentFragment();
    const visible = entries.slice(
      state.page * PAGE_SIZE,
      (state.page + 1) * PAGE_SIZE,
    );
    const rows = grouped
      ? visible.flatMap((group) => [
          { group },
          ...(state.expanded.has(group.pointId)
            ? group.measurements.map((point) => ({ point }))
            : []),
        ])
      : visible.map((point) => ({ point }));
    for (const entry of rows) {
      if (entry.group) {
        appendGroup(fragment, entry.group, outputKeys);
        continue;
      }
      const point = entry.point;
      const row = element(
          "tr",
          undefined,
          grouped ? "measurement-row child-measurement" : "measurement-row",
        ),
        name = element("td");
      row.dataset.recordId = point.recordId;
      row.dataset.pointId = point.pointId;
      name.append(
        element("span", point.name, "point-name"),
        element(
          "span",
          `${point.source}${point.line ? ` · line ${point.line}` : ""}`,
          "source-name",
        ),
      );
      name.title = `Point ID: ${point.pointId} · Measurement: ${point.measurementIndex ?? "unnumbered"} · Record: ${point.recordId}`;
      if (
        point.inputAngles &&
        (point.inputAngles.latitudeFormat !== "decimal" ||
          point.inputAngles.longitudeFormat !== "decimal")
      ) {
        name.append(
          element("span", "DMS normalized to decimal", "angle-normalized"),
        );
      }
      if (point.collectedAt)
        name.append(
          element(
            "span",
            [point.collectedAt.date, point.collectedAt.time]
              .filter(Boolean)
              .join(" "),
            "collection-time",
          ),
        );
      const latCell = element("td", point.lat),
        longCell = element("td", point.long);
      if (point.inputAngles) {
        latCell.title = `Original: ${point.inputAngles.latitude} (${point.inputAngles.latitudeFormat})`;
        longCell.title = `Original: ${point.inputAngles.longitude} (${point.inputAngles.longitudeFormat})`;
      }
      row.append(name, latCell, longCell, element("td", point.elevation));
      for (const key of outputKeys)
        row.append(
          element(
            "td",
            point.result ? point.result[key].toFixed(3) : "—",
            "result-col",
          ),
        );
      const status = element("td");
      const labels = {
        ready: "Ready",
        converting: "Converting…",
        done: "Converted",
        error: "Failed · retry",
      };
      const badge = element(
        "span",
        labels[point.status],
        `badge ${point.status}`,
      );
      if (point.error) {
        badge.title = point.error;
        badge.setAttribute("aria-label", `Conversion failed: ${point.error}`);
      }
      status.append(badge);
      const request = element("td"),
        link = element("a", "Open ↗", "request-link");
      link.href = C.buildUrl(point);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute(
        "aria-label",
        `Open LandsD conversion for ${point.name}`,
      );
      request.append(link);
      row.append(status, request);
      fragment.append(row);
    }
    body.append(fragment);
  }

  async function decodeFile(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      throw new Error(
        "Could not read the text encoding. Save this file as UTF-8 or UTF-16 with a byte-order mark.",
      );
    }
  }
  async function importFiles(fileList) {
    if (state.importing || state.converting || !fileList.length) return;
    state.importing = true;
    render();
    const angleFormat = $("angle-format").value;
    const gridPoints = [];
    let added = 0,
      rejected = 0;
    const formats = { decimal: 0, dms: 0, packed: 0, mixed: 0 };
    for (const file of Array.from(fileList)) {
      try {
        if (!/\.(txt|csv|tsv)$/i.test(file.name))
          throw new Error("Please choose a .txt, .csv or .tsv export.");
        if (file.size > 20 * 1024 * 1024)
          throw new Error(
            "This file exceeds 20 MB. Split the export into smaller files.",
          );
        const text = await decodeFile(file);
        if (C.isGridText(text)) {
          const grid = C.parseGridText(text);
          if (grid.issues.length) {
            for (const issue of grid.issues)
              state.issues.push({
                ...issue,
                source: file.name,
                message: `${issue.message} This grid file was not loaded; correct its rows and retry.`,
              });
            rejected += grid.issues.length;
          } else {
            gridPoints.push(
              ...grid.points.map((point) => ({ ...point, source: file.name })),
            );
          }
          continue;
        }
        const result = C.parseExport(text, file.name, {
          angleFormat,
        });
        for (const point of result.points)
          state.points.push(newMeasurement(point));
        for (const issue of result.issues) state.issues.push(issue);
        if (result.rowCount === 0)
          state.issues.push({
            source: file.name,
            message:
              "The header was found, but the file contains no point records.",
          });
        state.files.push({
          name: file.name,
          count: result.points.length,
          uniqueCount: C.groupMeasurements(result.points).length,
          rejected: result.issues.length,
          formatCounts: result.formatCounts,
          profile: result.profile,
          fieldMapping: result.fieldMapping,
        });
        for (const format of Object.keys(formats))
          formats[format] += result.formatCounts[format];
        added += result.points.length;
        rejected += result.issues.length;
      } catch (error) {
        state.issues.push({ source: file.name, message: error.message });
        rejected++;
      }
    }
    state.importing = false;
    state.page = 0;
    ui["file-input"].value = "";
    announce(
      `${added.toLocaleString()} measurements added. Workspace: ${C.groupMeasurements(state.points).length.toLocaleString()} unique points / ${state.points.length.toLocaleString()} measurements.${added ? ` Interpreted as ${describeFormats(formats)}.` : ""}${rejected ? ` ${rejected} row or file issue${rejected === 1 ? "" : "s"}; expand the import issues to review.` : " Ready for conversion."}`,
      !added && !gridPoints.length,
    );
    render();
    if (gridPoints.length) {
      selectInputTab("grid-tab");
      const cell = (value) =>
        /[",\r\n]/.test(String(value))
          ? `"${String(value).replace(/"/g, '""')}"`
          : String(value);
      $("grid-input").value = [
        "Name,N,E,Z",
        ...gridPoints.map((point) =>
          [point.name, point.northing, point.easting, point.z]
            .map(cell)
            .join(","),
        ),
      ].join("\n");
      await loadGridPoints({ parsed: { points: gridPoints, issues: [] } });
      if (!rejected)
        announce(
          `${added} GNSS readings imported; ${gridPoints.length} grid points detected by their CSV headings. See the map-loading status in the point input tab.`,
        );
    }
  }

  function selectInputTab(tab, focus = false) {
    for (const id of ["files-tab", "grid-tab"]) {
      const selected = id === tab;
      $(id).setAttribute("aria-selected", String(selected));
      $(id).tabIndex = selected ? 0 : -1;
      $($(id).getAttribute("aria-controls")).hidden = !selected;
    }
    if (focus) $(tab).focus();
    $("import-heading").lastChild.textContent =
      tab === "grid-tab" ? " Paste your points" : " Add your files";
  }

  function showGridIssues(issues) {
    $("grid-issues").replaceChildren(
      ...issues.map((issue) =>
        element(
          "li",
          `Line ${issue.line}${issue.name ? ` (${issue.name})` : ""}: ${issue.message}`,
        ),
      ),
    );
    $("grid-issues").hidden = !issues.length;
  }

  async function loadGridPoints(options = {}) {
    if (state.importing || state.converting) return;
    showGridIssues([]);
    let parsed;
    try {
      if ($("grid-input").value.length > 20 * 1024 * 1024)
        throw new Error(
          "The pasted text exceeds 20 MB. Split it into smaller sets.",
        );
      parsed = options.parsed || C.parseGridText($("grid-input").value);
      if (parsed.issues.length) {
        showGridIssues(parsed.issues);
        throw new Error(
          "Correct the rows listed below, then load again. Previously loaded points are kept.",
        );
      }
    } catch (error) {
      $("grid-status").textContent = error.message;
      return;
    }
    state.gridLoading = true;
    state.importing = true;
    state.gridController = new AbortController();
    const signal = state.gridController.signal;
    const locations = new Array(parsed.points.length);
    const issues = [];
    let next = 0,
      processed = 0;
    const progress = () => {
      $("grid-status").textContent =
        `HK80 grid input · plotting ${processed} / ${parsed.points.length} points on the map… Original N/E/Z stay unchanged.`;
    };
    progress();
    render();
    try {
      async function worker() {
        while (next < parsed.points.length && !signal.aborted) {
          const index = next++,
            point = parsed.points[index];
          try {
            locations[index] = await C.requestGridLocation(point, { signal });
          } catch (error) {
            if (!signal.aborted)
              issues.push({ ...point, message: error.message });
          }
          processed++;
          progress();
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(2, parsed.points.length) }, worker),
      );
      if (signal.aborted) {
        $("grid-status").textContent =
          "Loading stopped. Previously loaded points are kept.";
      } else if (issues.length) {
        showGridIssues(issues.sort((a, b) => a.line - b.line));
        $("grid-status").textContent =
          `${issues.length} point(s) could not be located. Previously loaded points are kept; retry after checking the rows or your connection.`;
      } else {
        state.gridPoints = locations;
        $("grid-status").textContent =
          `${locations.length} HK1980 point(s) loaded in blue. Zoomed to the pasted set. Z values and names are retained; GNSS conversion downloads contain file readings only.`;
        render();
        window.GnssMap?.focus(locations);
        $("extent-heading").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    } finally {
      state.gridLoading = false;
      state.importing = false;
      state.gridController = null;
      render();
    }
  }

  for (const id of ["files-tab", "grid-tab"]) {
    $(id).addEventListener("click", () => selectInputTab(id));
    $(id).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      selectInputTab(
        event.key === "Home"
          ? "files-tab"
          : event.key === "End"
            ? "grid-tab"
            : id === "files-tab"
              ? "grid-tab"
              : "files-tab",
        true,
      );
    });
  }
  $("grid-load-button").addEventListener("click", loadGridPoints);
  $("grid-stop-button").addEventListener("click", () =>
    state.gridController?.abort(),
  );
  $("grid-clear-button").addEventListener("click", () => {
    if (state.importing || state.converting) return;
    state.gridPoints = [];
    $("grid-input").value = "";
    $("grid-status").textContent =
      "Pasted points cleared. GNSS file readings are kept.";
    showGridIssues([]);
    render();
  });
  $("grid-input").addEventListener("dragover", (event) =>
    event.preventDefault(),
  );
  $("grid-input").addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.importing || state.converting) return;
    const files = Array.from(event.dataTransfer.files);
    try {
      if (files.length) {
        if (files.length !== 1 || !/\.(txt|csv|tsv)$/i.test(files[0].name))
          throw new Error(
            "Drop one TXT, CSV or TSV point file into the text box.",
          );
        if (files[0].size > 20 * 1024 * 1024)
          throw new Error("This file exceeds 20 MB.");
        // Lock other imports while decoding a dropped file.
        state.importing = true;
        render();
        $("grid-input").value = await decodeFile(files[0]);
      } else {
        const input = $("grid-input");
        input.setRangeText(
          event.dataTransfer.getData("text/plain"),
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
      }
      showGridIssues([]);
      $("grid-status").textContent =
        "Text ready. Named headings determine EN/NE order. Without a header, use Name,N,E,Z. Click Load & zoom to points.";
    } catch (error) {
      $("grid-status").textContent = error.message;
    } finally {
      state.importing = false;
      render();
    }
  });

  async function convert() {
    if (state.importing || state.converting) return;
    const queue = state.points.filter((point) => !point.result);
    if (!queue.length) return;
    state.converting = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    let next = 0,
      completed = 0,
      succeeded = 0;
    $("progress-wrap").hidden = false;
    $("progress").max = queue.length;
    $("progress").value = 0;
    $("progress-label").textContent = `0 / ${queue.length} processed`;
    announce(
      "Converting WGS84 latitude / longitude (decimal degrees) + ellipsoidal height to HK80 northing / easting (metres) + height (mPD), using LandsD. You can stop at any time.",
    );
    render();
    async function worker() {
      while (!signal.aborted && next < queue.length) {
        const point = queue[next++];
        point.status = "converting";
        point.error = "";
        render();
        try {
          point.result = await C.requestConversion(point, { signal });
          point.status = "done";
          succeeded++;
        } catch (error) {
          if (signal.aborted) {
            point.status = "ready";
            point.error = "";
          } else {
            point.status = "error";
            point.error = error.message;
          }
        }
        if (!signal.aborted) completed++;
        $("progress").value = completed;
        $("progress-label").textContent =
          `${completed} / ${queue.length} processed`;
        render();
      }
    }
    // Two requests at a time keep larger exports responsive without flooding LandsD.
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, worker),
    );
    state.converting = false;
    state.controller = null;
    const failed = queue.filter((point) => point.status === "error");
    let message = signal.aborted
      ? `Conversion stopped. ${succeeded} new result${succeeded === 1 ? "" : "s"} saved; remaining measurements can be converted later.`
      : `${succeeded} of ${queue.length} measurements converted.`;
    if (failed.length)
      message += ` ${failed.length} failed. Use “Convert remaining” to retry. First error: ${failed[0].error}`;
    const example = queue.find((point) => point.isExample && point.result);
    if (example) {
      const matches = Object.keys(C.EXPECTED).every(
        (key) => example.result[key].toFixed(3) === C.EXPECTED[key].toFixed(3),
      );
      message += matches
        ? " Manual Example 3 matches the expected result."
        : " The live Example 3 result differs from the manual; review the returned values.";
    }
    const exportCount = C.meanCoordinates(state.points).length;
    if (exportCount)
      message += ` ${exportCount} complete point mean(s) ready in Results CSV and coordinate.txt.`;
    announce(message, failed.length > 0);
    render();
  }

  function download(contents, filename, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  ui["file-input"].addEventListener("change", (event) =>
    importFiles(event.target.files),
  );
  ui["drop-zone"].addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      !state.importing &&
      !state.converting
    ) {
      event.preventDefault();
      ui["file-input"].click();
    }
  });
  // Prevent dropped files from navigating the browser away from the page.
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
  ui["drop-zone"].addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth++;
    if (!state.importing && !state.converting)
      ui["drop-zone"].classList.add("dragging");
  });
  ui["drop-zone"].addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) ui["drop-zone"].classList.remove("dragging");
  });
  ui["drop-zone"].addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    ui["drop-zone"].classList.remove("dragging");
    importFiles(event.dataTransfer.files);
  });
  ui["example-button"].addEventListener("click", () => {
    if (state.importing || state.converting) return;
    const example = newMeasurement({
      ...C.EXAMPLE,
      source: "LandsD manual · page 9",
      isExample: true,
    });
    state.points.push(example);
    state.expanded.add(example.pointId);
    state.page = Math.floor(
      ((state.view === "grouped"
        ? C.groupMeasurements(state.points).length
        : state.points.length) -
        1) /
        PAGE_SIZE,
    );
    announce(
      "Manual Example 3 added. Convert with LandsD to check the live result.",
    );
    render();
  });
  ui["clear-button"].addEventListener("click", () => {
    if (state.importing || state.converting) return;
    state.points = [];
    state.files = [];
    state.issues = [];
    state.page = 0;
    state.expanded.clear();
    $("progress-wrap").hidden = true;
    ui["file-input"].value = "";
    announce("Workspace cleared.");
    render();
  });
  ui["convert-button"].addEventListener("click", convert);
  ui["stop-button"].addEventListener("click", () => {
    state.controller?.abort();
  });
  ui["prepared-button"].addEventListener("click", () =>
    download(
      C.preparedCsv(state.points),
      "gnss_prepared_wgs84.csv",
      "text/csv;charset=utf-8",
    ),
  );
  ui["results-button"].addEventListener("click", () =>
    download(
      C.resultsCsv(state.points, state.outputOrder),
      `gnss_hk1980_${state.outputOrder.toLowerCase()}_results.csv`,
      "text/csv;charset=utf-8",
    ),
  );
  ui["measurements-button"].addEventListener("click", () =>
    download(
      C.measurementsCsv(state.points, state.outputOrder),
      `gnss_hk1980_${state.outputOrder.toLowerCase()}_measurements.csv`,
      "text/csv;charset=utf-8",
    ),
  );
  ui["statistics-button"].addEventListener("click", () =>
    download(
      C.pointStatisticsCsv(state.points, state.outputOrder),
      `gnss_hk1980_${state.outputOrder.toLowerCase()}_point_statistics.csv`,
      "text/csv;charset=utf-8",
    ),
  );
  ui["coordinate-button"].addEventListener("click", () => {
    try {
      download(
        C.coordinateText(state.points, state.outputOrder),
        "coordinate.txt",
        "text/plain;charset=utf-8",
      );
    } catch (error) {
      announce(error.message, true);
    }
  });
  ui["json-button"].addEventListener("click", () =>
    download(
      C.resultsJson(state.points, state.outputOrder),
      `gnss_hk1980_${state.outputOrder.toLowerCase()}_results.json`,
      "application/json;charset=utf-8",
    ),
  );
  $("output-order").addEventListener("change", (event) => {
    state.outputOrder = event.target.value;
    render();
  });
  $("point-view").addEventListener("change", (event) => {
    state.view = event.target.value;
    state.page = 0;
    render();
  });
  $("expand-groups-button").addEventListener("click", () => {
    for (const group of C.groupMeasurements(state.points))
      state.expanded.add(group.pointId);
    render();
  });
  $("collapse-groups-button").addEventListener("click", () => {
    state.expanded.clear();
    render();
  });
  $("points-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-toggle-point]");
    if (!button) return;
    const pointId = button.dataset.togglePoint;
    if (state.expanded.has(pointId)) state.expanded.delete(pointId);
    else state.expanded.add(pointId);
    render();
    for (const toggle of $("points-body").querySelectorAll(
      "button[data-toggle-point]",
    ))
      if (toggle.dataset.togglePoint === pointId) {
        toggle.focus({ preventScroll: true });
        break;
      }
  });
  ui["previous-button"].addEventListener("click", () => {
    if (state.page > 0) state.page--;
    render();
  });
  ui["next-button"].addEventListener("click", () => {
    state.page++;
    render();
  });
  render();
})();
