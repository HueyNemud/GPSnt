# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-05

First public release.

### Added

- Android app: pedestrian dead reckoning on an offline tiled map, with Android's orientation
  fusion, step detection and Weinberg step length.
- Particle filter estimating position, compass bias and step scale, constrained by the walls of
  the map and corrected by manual fixes.
- Map kit (`mapkit/`): turns any map image into a map pack (tiles and wall mask), with walls
  found from colours or from a hand-drawn image.
- Demo map (public domain), embedded in the release APK.
- Sensor recording in the app, desktop replay and walk simulation tools.
- Documentation: user guide, map guide, developer guide and technical report.

[0.1.0]: https://github.com/HueyNemud/GPSnt/releases/tag/v0.1.0
