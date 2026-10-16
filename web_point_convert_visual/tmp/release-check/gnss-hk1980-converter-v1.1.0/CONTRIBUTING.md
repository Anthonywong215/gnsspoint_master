# Contributing

Author and maintainer: **Anthony Wong**.

Use Node.js 22 or later. The application requires no package installation or build step.

```text
npm test
npm start
```

Keep `converter.js` usable in both a browser and Node. Keep map/playback presentation in `map.js` and interface state in `app.js`. All API conversions operate on individual normalized measurements; point means are calculated only afterward.

When changing exports, test both EN and NE order, repeated measurement names across files, incomplete conversions, numeric precision and the exact four-column output. Preserve original measurement IDs and source provenance. Application output must never substitute sample values for a failed network response.

Use small synthetic fixtures when reporting an issue or adding a test. Run `npm test` for offline checks; `npm run test:live` is an optional check of the public LandsD reference example. A network outage must not make the offline suite fail.

Run `npm run package` to produce the shareable ZIP, checksum and file manifest in `release/`. The packager uses an explicit list of source/documentation folders and excludes temporary files, local survey data and generated outputs.
