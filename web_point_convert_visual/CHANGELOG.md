# Changelog

## Unreleased

- Add a ten-column spreadsheet layout CSV for the selected point, with retained statistics in the first five data rows and excluded observations marked in remarks. Name exports from the original input filename with _reduced/_converted suffixes, and offer Prepared TXT.
- Add per-point Data analysis and selection before MicroStation export: rank deviations, preselect removals for a retained-count target, review right-side checkboxes, and compare original/retained mean and sample SD. CAD exports use retained readings; detailed downloads preserve all records and exclusion reasons.
- Use ID,Latitude,Longitude,Height in Prepared CSV, support reimport of that exact WGS84 schema, and link the LandsD coordinate converter beside the download.
- Add an explicit EN/NE selector for headerless pasted coordinates, defaulting to Easting-first TXYZ so map lookups do not swap N/E; named CSV headings still take precedence.
- Fix reimport of the website's own Results CSV: map named ID/Name, EN/NE and Height/mPD/Z columns, and route existing HK80 grid CSVs from the main file drop area directly to the map while retaining N/E/Z.
- Add Small/Medium/Large/Full screen map sizes with view/playback preservation and point-name hover tooltips in Large and Full screen for both GNSS readings and pasted points.
- Add a writable Paste N,E,Z tab with text/file drop, HK1980 validation, blue map points and zoom to the pasted extent; retain original names/Z separately from GNSS conversion statistics.
- Synchronize the local website copies with the Topcon/Sino importer and guide, retain deferred map resizing, and document the GitHub Desktop repository folder.
- Support Topcon Name/B/L/84H exports without mistaking Elevation or Z for ellipsoidal height; preserve precision, repeated observations and Start time for playback.
- Show the detected receiver mapping and include a synthetic Topcon sample and import checks.
- Restore the root entry point's bundled Leaflet assets and supporting folders, fixing missing-map-library errors after cloning.
- Add asset-presence, Leaflet-integrity and deferred-script-order regression checks.
- Restore repository metadata and root CI checks so tests and release packaging run from the clone root.

## 1.1.0

- Default output is `ID,Easting,Northing,mPD`.
- Results CSV contains one mean-coordinate row per fully converted unique point.
- Direct `coordinate.txt` download uses headerless TXYZ, or TYXZ when Northing-first is selected.
- Incomplete point groups stay out of CAD exports; counts and per-measurement results remain available.
- Separate Measurements CSV preserves observation IDs, source details, times and errors.
- Numeric point suffixes group repeated readings, with expandable rows and point statistics.
- OpenStreetMap extent preview and chronological playback include every accepted measurement.
- Decimal/DMS validation, format selection, coordinate bounds and explicit datum reminders.
- Application fonts increased by 3 CSS pixels (2.25 points).
- Anthony Wong credited in the interface, documentation and package metadata.
- User guide, synthetic samples, offline tests, CI configuration and repeatable release packaging.
