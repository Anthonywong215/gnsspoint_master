# Changelog

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
