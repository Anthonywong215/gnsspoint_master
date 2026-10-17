/* Shared parsing and API contract. No dependencies; works under file:// and Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GnssConverter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ENDPOINT = "https://www.geodetic.gov.hk/transform/v2/";
  const EXAMPLE = Object.freeze({
    name: "Manual Example 3",
    lat: "22.32224",
    long: "114.14118",
    elevation: "23.128",
  });
  const EXPECTED = Object.freeze({
    hkN: 820358.91,
    hkE: 832590.508,
    hkpd: 26.009,
  });
  const ALIASES = {
    name: ["pointname", "pointid", "name"],
    lat: ["latitude", "lat"],
    long: ["longitude", "long", "lon", "lng"],
    elevation: ["elevation"],
  };
  const ERRORS = {
    1: "Missing mandatory parameter",
    2: "Unrecognized coordinate system",
    3: "Invalid input value",
    4: "Coordinates out of range",
    5: "Input and output systems are identical",
    6: "Invalid UTM coordinates",
    7: "Unrecognized coordinate unit",
  };
  const normalize = (value) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_.-]/g, "");
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const ANGLE_FORMATS = ["auto", "decimal", "dms", "packed"];

  function parseCollectionTimestamp(date, time) {
    const day = String(date || "")
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const clock = String(time || "")
      .trim()
      .match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/);
    if (!day || !clock) return null;
    const [, year, month, dayOfMonth] = day.map(Number);
    const hour = Number(clock[1]),
      minute = Number(clock[2]),
      second = Number(clock[3]);
    if (
      year < 1900 ||
      month < 1 ||
      month > 12 ||
      dayOfMonth < 1 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    )
      return null;
    // Sort recorded civil times; the export provides no timezone to convert.
    const sortable = Date.UTC(
      year,
      month - 1,
      dayOfMonth,
      hour,
      minute,
      second,
    );
    const check = new Date(sortable);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== dayOfMonth
    )
      return null;
    return sortable + Number(`0.${clock[4] || "0"}`) * 1000;
  }

  function collectionSequence(points) {
    const entries = points.map((point, index) => ({
      point,
      index,
      timestamp: parseCollectionTimestamp(
        point.collectedAt?.date,
        point.collectedAt?.time,
      ),
    }));
    const undatedCount = entries.filter(
      (entry) => entry.timestamp === null,
    ).length;
    const mode = entries.length && !undatedCount ? "time" : "import";
    if (mode === "time")
      entries.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
    return { points: entries.map((entry) => entry.point), mode, undatedCount };
  }

  function outputKeys(order = "EN") {
    if (order !== "NE" && order !== "EN")
      throw new Error("Output order must be NE or EN.");
    return order === "EN" ? ["hkE", "hkN", "hkpd"] : ["hkN", "hkE", "hkpd"];
  }

  function pointIdentity(name) {
    const original = String(name ?? "").trim();
    const match = original.match(/^(.+)\.(\d+)$/);
    return {
      pointId: match ? match[1] : original,
      measurementIndex: match ? match[2] : null,
    };
  }

  function groupMeasurements(points) {
    const groups = new Map();
    for (const point of points) {
      const pointId = point.pointId ?? pointIdentity(point.name).pointId;
      if (!groups.has(pointId))
        groups.set(pointId, {
          pointId,
          measurements: [],
          count: 0,
          convertedCount: 0,
          pendingCount: 0,
          errorCount: 0,
          statistics: null,
        });
      const group = groups.get(pointId);
      group.measurements.push(point);
      group.count++;
      if (!point.result) {
        if (point.status === "error") group.errorCount++;
        else group.pendingCount++;
        continue;
      }
      const result = validateResponse(point.result);
      group.convertedCount++;
      if (!group.statistics)
        group.statistics = Object.fromEntries(
          ["hkN", "hkE", "hkpd"].map((key) => [
            key,
            { mean: 0, m2: 0, min: Infinity, max: -Infinity },
          ]),
        );
      for (const key of ["hkN", "hkE", "hkpd"]) {
        const stats = group.statistics[key],
          value = result[key],
          delta = value - stats.mean;
        stats.mean += delta / group.convertedCount;
        stats.m2 += delta * (value - stats.mean);
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);
      }
    }
    for (const group of groups.values())
      if (group.statistics) {
        for (const stats of Object.values(group.statistics)) {
          stats.sampleSd =
            group.convertedCount > 1
              ? Math.sqrt(Math.max(0, stats.m2 / (group.convertedCount - 1)))
              : null;
          stats.range = stats.max - stats.min;
          delete stats.m2;
        }
      }
    return [...groups.values()];
  }

  function parseAngle(input, axis, format = "auto") {
    const label = axis === "lat" ? "Latitude" : "Longitude";
    if (!ANGLE_FORMATS.includes(format))
      throw new Error(
        "Unknown coordinate format. Choose decimal degrees or DMS.",
      );
    let text = String(input ?? "")
      .trim()
      .replace(/\u2212/g, "-");
    if (!text)
      throw new Error(
        `${label} must be a number or a complete DMS angle; the field is empty.`,
      );
    const prefix = text.match(/^([NSEW])\s*/i);
    if (prefix) text = text.slice(prefix[0].length).trim();
    const suffix = text.match(/\s*([NSEW])$/i);
    if (suffix) text = text.slice(0, -suffix[0].length).trim();
    if (prefix && suffix)
      throw new Error(
        `${label} has more than one hemisphere marker. Use a single N/S or E/W.`,
      );
    const hemisphere = (prefix?.[1] || suffix?.[1] || "").toUpperCase();
    if (hemisphere && !(axis === "lat" ? /^[NS]$/ : /^[EW]$/).test(hemisphere))
      throw new Error(
        `${label} has the wrong hemisphere marker: use ${axis === "lat" ? "N or S" : "E or W"}. Latitude and longitude may be swapped.`,
      );
    if (
      (text.startsWith("-") && /^[NE]$/.test(hemisphere)) ||
      (text.startsWith("+") && /^[SW]$/.test(hemisphere))
    )
      throw new Error(`${label} sign conflicts with its hemisphere marker.`);
    const decimal = text.replace(/\s*[°º]\s*$/, "");
    let parts, detected;
    if (format !== "packed") {
      parts =
        text.match(
          /^([+-]?\d+)\s*[°ºd]\s*(\d+)\s*['′’m]\s*(\d+(?:\.\d+)?)\s*(?:["″”s])?$/i,
        ) ||
        text.match(/^([+-]?\d+)\s*:\s*(\d+)\s*:\s*(\d+(?:\.\d+)?)$/) ||
        text.match(/^([+-]?\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)$/);
    }
    if (format === "packed") {
      // DD.MMSSsss is ambiguous with decimal degrees and is never auto-detected.
      const packed = text.match(/^([+-]?\d{1,3})\.(\d{2})(\d{2})(\d*)$/);
      if (!packed)
        throw new Error(
          `${label} must use packed DMS DD.MMSS… (for example 22.191234). Choose Auto for separated DMS or decimal degrees.`,
        );
      parts = [
        text,
        packed[1],
        packed[2],
        packed[3] + (packed[4] ? `.${packed[4]}` : ""),
      ];
      detected = "packed";
    }
    let value;
    if (parts) {
      if (format === "decimal")
        throw new Error(
          `${label} contains DMS, but Decimal degrees is selected. Choose Auto or DMS and import again.`,
        );
      const degrees = Math.abs(Number(parts[1])),
        minutes = Number(parts[2]),
        seconds = Number(parts[3]);
      if (minutes >= 60 || seconds >= 60)
        throw new Error(
          `${label} DMS minutes and seconds must each be less than 60.`,
        );
      value = degrees + minutes / 60 + seconds / 3600;
      if (parts[1].startsWith("-")) value = -value;
      detected = detected || "dms";
    } else if (
      format !== "dms" &&
      NUMBER.test(decimal) &&
      Number.isFinite(Number(decimal))
    ) {
      value = Number(decimal);
      detected = "decimal";
    } else {
      throw new Error(
        `${label} must be ${format === "dms" ? "complete DMS" : "a number in decimal degrees or complete DMS"} (for example 22.32224 or 22°19′20.064″). Two-part degrees/minutes and compact DDMMSS are not accepted.`,
      );
    }
    if (hemisphere)
      value = Math.abs(value) * (/^[SW]$/.test(hemisphere) ? -1 : 1);
    const limit = axis === "lat" ? 90 : 180;
    if (!Number.isFinite(value) || Math.abs(value) > limit)
      throw new Error(
        `${label} exceeds ${limit}°. Check the angle format and whether latitude and longitude are swapped.`,
      );
    // Keep decimal source precision; round DMS arithmetic only beyond survey precision.
    const normalized =
      detected === "decimal"
        ? /^[SW]$/.test(hemisphere)
          ? `-${decimal.replace(/^[+-]/, "")}`
          : decimal
        : String(Number(value.toFixed(12)));
    return {
      value: normalized,
      format: detected,
      original: String(input).trim(),
    };
  }

  function parseDelimited(text, delimiter) {
    const records = [];
    let cells = [],
      value = "",
      quoted = false,
      closed = false,
      line = 1,
      startLine = 1;
    function finishCell() {
      cells.push(value);
      value = "";
      closed = false;
    }
    function finishRow() {
      finishCell();
      if (cells.some((cell) => cell.trim() !== ""))
        records.push({ cells, line: startLine });
      cells = [];
      startLine = line + 1;
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else {
          value += char;
          if (char === "\n") line++;
        }
      } else if (char === '"') {
        // Survey TXT often uses a literal double-quote seconds symbol in an unquoted DMS field.
        const dmsSeconds =
          /^(?:[NSWE]\s*)?[+-]?\d+(?:\s*[°ºd:]\s*|\s+)\d+(?:\s*['′’m:]\s*|\s+)\d+(?:\.\d+)?\s*$/i.test(
            value,
          );
        if (dmsSeconds && !closed) value += char;
        else {
          if (value.trim() !== "" || closed)
            throw new Error(
              `Unexpected quote at line ${line}. Quote CSV fields and escape any inner double quotes.`,
            );
          quoted = true;
          value = "";
        }
      } else if (char === delimiter) finishCell();
      else if (char === "\n" || char === "\r") {
        finishRow();
        if (char === "\r" && text[i + 1] === "\n") i++;
        line++;
      } else {
        if (closed && char.trim() !== "")
          throw new Error(
            `Unexpected text after a closing quote at line ${line}.`,
          );
        if (!closed) value += char;
      }
    }
    if (quoted)
      throw new Error(`Unclosed quoted field beginning at line ${startLine}.`);
    if (value !== "" || cells.length || closed) finishRow();
    return records;
  }

  function validatePoint(point) {
    if (!point.name || !point.name.trim()) return "Point name is empty.";
    if (
      Number(point.lat) >= 113.82 &&
      Number(point.lat) <= 114.48 &&
      Number(point.long) >= 22.13 &&
      Number(point.long) <= 22.57
    )
      return "Latitude and longitude appear swapped. Use WGS84 latitude around 22° and longitude around 114°.";
    for (const [key, label, min, max] of [
      ["lat", "Latitude", 22.13, 22.57],
      ["long", "Longitude", 113.82, 114.48],
      ["elevation", "Elevation", -1000, 10000],
    ]) {
      const value = String(point[key] ?? "").trim();
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
        !Number.isFinite(Number(value))
      )
        return `${label} must be a number; got "${value}".`;
      if (Number(value) < min || Number(value) > max)
        return `${label} must be between ${min} and ${max}, as required by LandsD.`;
    }
    return null;
  }

  function parseExport(
    input,
    source = "export.txt",
    { angleFormat = "auto" } = {},
  ) {
    if (!ANGLE_FORMATS.includes(angleFormat))
      throw new Error("Unknown coordinate format.");
    const text = input.replace(/^\uFEFF/, "");
    if (!text.trim()) throw new Error("This file is empty.");
    const header = text.split(/\r\n|\n|\r/).find((line) => line.trim()) || "";
    const delimiter = [",", "\t", ";"].sort(
      (a, b) => header.split(b).length - header.split(a).length,
    )[0];
    const records = parseDelimited(text, delimiter);
    if (!records.length) throw new Error("This file is empty.");
    const headers = records[0].cells.map(normalize);
    // Topcon's "Elevation" is not its ellipsoidal height. Select a complete
    // receiver schema before resolving fields; never fall back to that column.
    const topcon = headers.some((name) => ["b", "l", "84h"].includes(name));
    const aliases = topcon
      ? { name: ["name"], lat: ["b"], long: ["l"], elevation: ["84h"] }
      : ALIASES;
    const profile = topcon ? "Topcon" : "Standard";
    const fieldMapping = topcon
      ? "Name → ID · B → latitude · L → longitude · 84H → WGS84 height"
      : "Point name → ID · Latitude / Longitude · Elevation → WGS84 height";
    const columns = {};
    for (const [key, names] of Object.entries(aliases)) {
      const indices = headers.flatMap((name, index) =>
        names.includes(name) ? [index] : [],
      );
      if (!indices.length)
        throw new Error(
          topcon
            ? `Missing required Topcon column: ${names[0] === "84h" ? "84H (WGS84 ellipsoidal height)" : names[0].toUpperCase()}. Topcon requires Name, B, L and 84H; Elevation and Z are not substituted for 84H.`
            : `Missing required column: ${key === "name" ? "Point name" : key === "lat" ? "Latitude" : key === "long" ? "Longitude" : "Elevation"}. The export must have a header row. Height is not substituted for Elevation.`,
        );
      if (indices.length > 1)
        throw new Error(
          `More than one ${key} column was found; the mapping is ambiguous.`,
        );
      columns[key] = indices[0];
    }
    const points = [],
      issues = [],
      formatCounts = { decimal: 0, dms: 0, packed: 0, mixed: 0 };
    const dateIndex = headers.indexOf("date"),
      timeIndex = headers.indexOf("time"),
      startTimeIndex = topcon ? headers.indexOf("starttime") : -1;
    for (const record of records.slice(1)) {
      const point = { source, line: record.line };
      for (const [key, index] of Object.entries(columns))
        point[key] = (record.cells[index] ?? "").trim();
      Object.assign(point, pointIdentity(point.name));
      if (topcon) point.sourceFormat = "Topcon";
      if (startTimeIndex !== -1) {
        const original = (record.cells[startTimeIndex] || "").trim();
        const timestamp = original.match(
          /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)$/,
        );
        point.collectedAt = {
          date: timestamp
            ? `${timestamp[1]}-${timestamp[2].padStart(2, "0")}-${timestamp[3].padStart(2, "0")}`
            : "",
          time: timestamp ? timestamp[4] : "",
          original,
        };
      } else if (dateIndex !== -1 || timeIndex !== -1)
        point.collectedAt = {
          date: dateIndex === -1 ? "" : (record.cells[dateIndex] || "").trim(),
          time: timeIndex === -1 ? "" : (record.cells[timeIndex] || "").trim(),
        };
      let problem;
      try {
        if (record.cells.length !== headers.length)
          throw new Error(
            `Expected ${headers.length} columns, found ${record.cells.length}.`,
          );
        const latitude = parseAngle(point.lat, "lat", angleFormat);
        const longitude = parseAngle(point.long, "long", angleFormat);
        point.lat = latitude.value;
        point.long = longitude.value;
        point.inputAngles = {
          latitude: latitude.original,
          longitude: longitude.original,
          latitudeFormat: latitude.format,
          longitudeFormat: longitude.format,
        };
        problem = validatePoint(point);
      } catch (error) {
        problem = error.message;
      }
      if (problem)
        issues.push({
          source,
          line: record.line,
          name: point.name,
          message: problem,
        });
      else {
        points.push(point);
        const formats = point.inputAngles;
        formatCounts[
          formats.latitudeFormat === formats.longitudeFormat
            ? formats.latitudeFormat
            : "mixed"
        ]++;
      }
    }
    return {
      points,
      issues,
      formatCounts,
      profile,
      fieldMapping,
      rowCount: records.length - 1,
    };
  }

  function buildUrl(point) {
    const problem = validatePoint(point);
    if (problem) throw new Error(problem);
    const params = new URLSearchParams({
      inSys: "wgsgeog",
      outSys: "hkgrid",
      lat: point.lat,
      long: point.long,
      h: point.elevation,
      inUnit: "decDeg",
    });
    return `${ENDPOINT}?${params}`;
  }

  function coordinateBounds(points) {
    if (!points.length) return null;
    const bounds = {
      south: Infinity,
      west: Infinity,
      north: -Infinity,
      east: -Infinity,
    };
    for (const point of points) {
      if (validatePoint(point))
        throw new Error(
          "Map bounds require valid, normalized WGS84 coordinates.",
        );
      const lat = Number(point.lat),
        long = Number(point.long);
      bounds.south = Math.min(bounds.south, lat);
      bounds.north = Math.max(bounds.north, lat);
      bounds.west = Math.min(bounds.west, long);
      bounds.east = Math.max(bounds.east, long);
    }
    return bounds;
  }

  function validateResponse(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("LandsD returned an unexpected response.");
    if (data.ErrorCode !== undefined)
      throw new Error(
        `LandsD error ${data.ErrorCode}: ${ERRORS[data.ErrorCode] || "Unknown API error"}.`,
      );
    for (const key of ["hkN", "hkE", "hkpd"]) {
      if (typeof data[key] !== "number" || !Number.isFinite(data[key]))
        throw new Error(`LandsD did not return a valid ${key} value.`);
    }
    return { hkN: data.hkN, hkE: data.hkE, hkpd: data.hkpd };
  }

  async function requestConversion(
    point,
    { signal, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {},
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(buildUrl(point), {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok)
        throw new Error(
          `LandsD returned HTTP ${response.status}. Try again later.`,
        );
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error("LandsD returned a response that is not valid JSON.");
      }
      return validateResponse(data);
    } catch (error) {
      if (timedOut)
        throw new Error(
          "LandsD did not respond within 30 seconds. Retry this point.",
        );
      if (signal?.aborted)
        throw new DOMException("Conversion stopped.", "AbortError");
      if (error instanceof TypeError)
        throw new Error(
          "Could not reach LandsD. Check your internet connection, then retry or open the point’s government request.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  function csvCell(value, protectFormula = false) {
    let text = String(value ?? "");
    if (protectFormula && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  function makeCsv(headers, rows) {
    return (
      "\uFEFF" +
      [headers, ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(","))
        .join("\r\n") +
      "\r\n"
    );
  }
  function safeName(name) {
    return /^[\s]*[=+\-@]/.test(name) ? `'${name}` : name;
  }
  function preparedCsv(points) {
    return makeCsv(
      ["Point name", "Latitude", "Longitude", "Elevation"],
      points.map((p) => [safeName(p.name), p.lat, p.long, p.elevation]),
    );
  }
  function measurementsCsv(points, order = "EN") {
    const keys = outputKeys(order);
    return makeCsv(
      [
        "Point name",
        ...keys,
        "Point ID",
        "Measurement index",
        "Record ID",
        "Source file",
        "Source line",
        "Latitude",
        "Longitude",
        "Elevation",
        "Input latitude",
        "Input longitude",
        "Latitude format",
        "Longitude format",
        "Collection date",
        "Collection time",
        "Status",
        "Error",
        "Source format",
        "Original collection timestamp",
      ],
      points.map((p) => [
        safeName(p.name),
        ...keys.map((key) => p.result?.[key].toFixed(3)),
        safeName(p.pointId ?? pointIdentity(p.name).pointId),
        p.measurementIndex ?? pointIdentity(p.name).measurementIndex ?? "",
        p.recordId || "",
        safeName(p.source || ""),
        p.line || "",
        p.lat,
        p.long,
        p.elevation,
        p.inputAngles?.latitude ?? p.lat,
        p.inputAngles?.longitude ?? p.long,
        p.inputAngles?.latitudeFormat || "decimal",
        p.inputAngles?.longitudeFormat || "decimal",
        safeName(p.collectedAt?.date || ""),
        safeName(p.collectedAt?.time || ""),
        p.status,
        p.error || "",
        p.sourceFormat || "Standard",
        safeName(p.collectedAt?.original || ""),
      ]),
    );
  }

  function meanCoordinates(points) {
    return groupMeasurements(points)
      .filter((group) => group.convertedCount === group.count)
      .map((group) => ({
        pointId: group.pointId,
        ...Object.fromEntries(
          ["hkE", "hkN", "hkpd"].map((key) => [
            key,
            group.statistics[key].mean,
          ]),
        ),
      }));
  }

  function resultsCsv(points, order = "EN") {
    const keys = outputKeys(order);
    const labels = { hkE: "Easting", hkN: "Northing", hkpd: "mPD" };
    return makeCsv(
      ["ID", ...keys.map((key) => labels[key])],
      meanCoordinates(points).map((point) => [
        safeName(point.pointId),
        ...keys.map((key) => point[key].toFixed(3)),
      ]),
    );
  }

  function pointStatisticsCsv(points, order = "EN") {
    const keys = outputKeys(order);
    return makeCsv(
      [
        "Point ID",
        "Measurements",
        "Converted measurements",
        "Pending measurements",
        "Failed measurements",
        ...keys.flatMap((key) => [
          `${key} mean (m)`,
          `${key} sample SD (m)`,
          `${key} min (m)`,
          `${key} max (m)`,
          `${key} range (m)`,
        ]),
      ],
      groupMeasurements(points).map((group) => [
        safeName(group.pointId),
        group.count,
        group.convertedCount,
        group.pendingCount,
        group.errorCount,
        ...keys.flatMap((key) => {
          const stats = group.statistics?.[key];
          return stats
            ? [
                stats.mean.toFixed(6),
                stats.sampleSd === null ? "" : stats.sampleSd.toFixed(6),
                stats.min.toFixed(3),
                stats.max.toFixed(3),
                stats.range.toFixed(6),
              ]
            : ["", "", "", "", ""];
        }),
      ]),
    );
  }
  function coordinateText(points, order = "EN") {
    const keys = outputKeys(order);
    const rows = meanCoordinates(points).map((point) => {
      if (/[,"\r\n]/.test(point.pointId))
        throw new Error(
          `Point ID "${point.pointId}" contains a comma, quote or line break that is not supported by TXYZ text. Use Results CSV or rename the point before creating coordinate.txt.`,
        );
      return [point.pointId, ...keys.map((key) => point[key].toFixed(3))].join(
        ",",
      );
    });
    return rows.length ? rows.join("\r\n") + "\r\n" : "";
  }
  function resultsJson(points, order = "EN") {
    const keys = outputKeys(order);
    return JSON.stringify(
      points.map((p) => ({
        pointName: p.name,
        pointId: p.pointId ?? pointIdentity(p.name).pointId,
        measurementIndex:
          p.measurementIndex ?? pointIdentity(p.name).measurementIndex,
        recordId: p.recordId,
        sourceFile: p.source,
        sourceFormat: p.sourceFormat || "Standard",
        sourceLine: p.line,
        latitude: Number(p.lat),
        longitude: Number(p.long),
        elevation: Number(p.elevation),
        inputAngles: p.inputAngles,
        collectedAt: p.collectedAt,
        status: p.status,
        ...(p.result
          ? Object.fromEntries(keys.map((key) => [key, p.result[key]]))
          : {}),
        ...(p.error ? { error: p.error } : {}),
      })),
      null,
      2,
    );
  }
  return {
    ENDPOINT,
    EXAMPLE,
    EXPECTED,
    parseCollectionTimestamp,
    collectionSequence,
    outputKeys,
    pointIdentity,
    groupMeasurements,
    meanCoordinates,
    pointStatisticsCsv,
    parseAngle,
    parseDelimited,
    parseExport,
    validatePoint,
    buildUrl,
    coordinateBounds,
    validateResponse,
    requestConversion,
    preparedCsv,
    resultsCsv,
    measurementsCsv,
    resultsJson,
    coordinateText,
  };
});
