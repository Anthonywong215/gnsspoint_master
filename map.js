"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.GnssConverter;
  let map, bounds, pointsLayer, boundsLayer, trailLayer, currentMarker;
  let lastCount = -1,
    lastFirst,
    lastLast,
    currentPoints = [];
  let sequence = { points: [], mode: "import", undatedCount: 0 };
  let phase = "idle",
    revealed = 0,
    timer = null;

  function fit() {
    if (map && bounds) {
      map.invalidateSize();
      map.fitBounds(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { padding: [32, 32], maxZoom: 18, animate: false },
      );
    }
  }
  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function recordedTime(point) {
    const text = [point.collectedAt?.date, point.collectedAt?.time]
      .filter(Boolean)
      .join(" ");
    return text
      ? text +
          (C.parseCollectionTimestamp(
            point.collectedAt?.date,
            point.collectedAt?.time,
          ) === null
            ? " (incomplete or invalid timestamp)"
            : " (as recorded)")
      : "Collection date/time unavailable";
  }
  function renderPlayback() {
    const available = !!map && currentPoints.length > 0;
    $("play-map-button").disabled = !available;
    $("show-all-map-button").disabled = !available || phase === "idle";
    $("playback-delay").disabled = !available;
    $("play-map-button").textContent =
      phase === "playing"
        ? "Ⅱ Pause playback"
        : phase === "paused"
          ? "▶ Resume playback"
          : phase === "complete"
            ? "↻ Replay collection"
            : "▶ Play collection";
    $("mini-map").dataset.playbackState = phase;
    $("mini-map").dataset.visiblePointCount = String(
      phase === "idle" ? currentPoints.length : revealed,
    );
    $("playback-progress").max = Math.max(1, currentPoints.length);
    $("playback-progress").value =
      phase === "idle" ? currentPoints.length : revealed;
    $("playback-order").textContent =
      sequence.mode === "time"
        ? "Order: collection date/time across all files; equal timestamps keep import order. Times are shown as recorded. Fixed delay per point; actual time gaps are not reproduced."
        : currentPoints.length
          ? `Order: file/import order because ${sequence.undatedCount} point(s) have missing or invalid date/time. Fixed delay per point; no collection times are inferred.`
          : "Uses export date/time when every point has a valid timestamp; otherwise uses import order. Playback uses a fixed delay, independent of real time gaps.";
    const point = revealed ? sequence.points[revealed - 1] : null;
    $("playback-status").textContent = !currentPoints.length
      ? "Import points to play their collection sequence."
      : phase === "idle"
        ? `All ${currentPoints.length.toLocaleString()} measurements shown. Play collection to reveal them one at a time.`
        : `${phase === "paused" ? "Paused · " : phase === "complete" ? "Complete · " : ""}${revealed.toLocaleString()} / ${currentPoints.length.toLocaleString()} · ${point?.name || ""} · ${point ? recordedTime(point) : ""}`;
  }
  function addPoint(point) {
    const popup = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = point.name;
    const identity = document.createElement("p");
    identity.textContent = `Point ID: ${point.pointId ?? C.pointIdentity(point.name).pointId} · measurement ${point.measurementIndex ?? C.pointIdentity(point.name).measurementIndex ?? "unnumbered"}`;
    const coordinates = document.createElement("p");
    coordinates.textContent = `WGS84 ${point.lat}°, ${point.long}°`;
    const time = document.createElement("p");
    time.textContent = recordedTime(point);
    const source = document.createElement("small");
    source.textContent = point.source || "";
    popup.append(title, identity, coordinates, time, source);
    L.circleMarker([Number(point.lat), Number(point.long)], {
      radius: 4,
      color: "#17664d",
      weight: 1,
      fillColor: "#308969",
      fillOpacity: 0.65,
    })
      .bindPopup(popup)
      .addTo(pointsLayer);
  }
  function clearTrail() {
    if (trailLayer) {
      map.removeLayer(trailLayer);
      trailLayer = null;
    }
    if (currentMarker) {
      map.removeLayer(currentMarker);
      currentMarker = null;
    }
  }
  function showAll() {
    stopTimer();
    phase = "idle";
    revealed = 0;
    if (map) {
      pointsLayer.clearLayers();
      clearTrail();
      for (const point of currentPoints) addPoint(point);
    }
    renderPlayback();
  }
  function scheduleNext() {
    stopTimer();
    if (phase === "playing")
      timer = setTimeout(revealNext, Number($("playback-delay").value));
  }
  function revealNext() {
    timer = null;
    if (phase !== "playing" || revealed >= sequence.points.length) return;
    const point = sequence.points[revealed++];
    addPoint(point);
    const position = [Number(point.lat), Number(point.long)];
    trailLayer.addLatLng(position);
    if (currentMarker) currentMarker.setLatLng(position);
    else
      currentMarker = L.circleMarker(position, {
        radius: 9,
        color: "#c37b25",
        weight: 3,
        fillOpacity: 0,
        interactive: false,
      }).addTo(map);
    if (revealed === sequence.points.length) phase = "complete";
    renderPlayback();
    if (phase === "playing") scheduleNext();
  }
  function togglePlayback() {
    if (!map || !currentPoints.length) return;
    if (phase === "playing") {
      stopTimer();
      phase = "paused";
      renderPlayback();
      return;
    }
    if (phase === "paused") {
      phase = "playing";
      renderPlayback();
      scheduleNext();
      return;
    }
    stopTimer();
    pointsLayer.clearLayers();
    clearTrail();
    revealed = 0;
    phase = "playing";
    trailLayer = L.polyline([], {
      color: "#c37b25",
      weight: 2,
      opacity: 0.65,
      interactive: false,
    }).addTo(map);
    revealNext();
  }
  function update(points) {
    // Conversion status and output order changes must not reset an active playback.
    if (
      lastCount === points.length &&
      lastFirst === points[0] &&
      lastLast === points[points.length - 1]
    )
      return;
    lastCount = points.length;
    lastFirst = points[0];
    lastLast = points[points.length - 1];
    stopTimer();
    phase = "idle";
    revealed = 0;
    currentPoints = points.slice();
    sequence = C.collectionSequence(currentPoints);
    bounds = C.coordinateBounds(points);
    $("fit-map-button").disabled = !bounds;
    $("mini-map").dataset.pointCount = String(points.length);
    const uniqueCount = new Set(
      points.map(
        (point) => point.pointId ?? C.pointIdentity(point.name).pointId,
      ),
    ).size;
    $("mini-map").dataset.uniquePointCount = String(uniqueCount);
    $("map-empty").hidden = !!bounds;
    $("mini-map").hidden = !bounds;
    $("map-point-count").textContent = bounds
      ? `${uniqueCount.toLocaleString()} unique points · ${points.length.toLocaleString()} measurements · all files`
      : "Import points to see their location and bounding box.";
    for (const key of ["north", "south", "east", "west"])
      $("bound-" + key).textContent = bounds
        ? `${bounds[key].toFixed(9)}°`
        : "—";
    if (!bounds) {
      if (map) {
        map.remove();
        map = null;
        pointsLayer = null;
        boundsLayer = null;
        trailLayer = null;
        currentMarker = null;
      }
      $("map-status").textContent =
        "OpenStreetMap background requires internet access. Point names remain in your browser.";
      renderPlayback();
      return;
    }
    if (!window.L) {
      $("map-status").textContent =
        "Map library could not load. Keep the vendor folder beside index.html. Bounding coordinates are shown above.";
      renderPlayback();
      return;
    }
    const localFile = location.protocol === "file:";
    if (!map) {
      map = L.map("mini-map", { preferCanvas: true, scrollWheelZoom: false });
      L.control.scale({ imperial: false }).addTo(map);
      // OSM requires an HTTP referrer: use the included local launcher for background tiles.
      if (!localFile) {
        const tiles = L.tileLayer(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            referrerPolicy: "strict-origin-when-cross-origin",
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
          },
        ).addTo(map);
        tiles.on("tileerror", () => {
          $("map-status").textContent =
            "OpenStreetMap background is unavailable. Your points and bounding box are still shown; check the internet connection.";
        });
        tiles.on("load", () => {
          $("map-status").textContent =
            "OpenStreetMap background · green points: observations · orange ring: current playback point · dashed rectangle: full data bounds.";
        });
      }
      boundsLayer = L.layerGroup().addTo(map);
      pointsLayer = L.layerGroup().addTo(map);
    }
    boundsLayer.clearLayers();
    L.rectangle(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      {
        color: "#b17634",
        weight: 2,
        dashArray: "6 4",
        fillColor: "#c9a56f",
        fillOpacity: 0.07,
        interactive: false,
      },
    ).addTo(boundsLayer);
    showAll();
    $("map-status").textContent = localFile
      ? "Points and bounds are shown. Double-click start.cmd to open this website with the OpenStreetMap background, then import your files there."
      : "OpenStreetMap background · green points: observations · orange ring: current playback point · dashed rectangle: full data bounds.";
    if (bounds.north === bounds.south && bounds.east === bounds.west)
      $("map-status").textContent +=
        " All points share one location; the bounding box has zero area.";
    fit();
  }
  $("fit-map-button").addEventListener("click", fit);
  $("play-map-button").addEventListener("click", togglePlayback);
  $("show-all-map-button").addEventListener("click", showAll);
  $("playback-delay").addEventListener("change", () => {
    if (phase === "playing") scheduleNext();
  });
  window.addEventListener("pagehide", stopTimer);
  window.GnssMap = { update, fit };
})();
