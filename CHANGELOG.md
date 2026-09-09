# Changelog

## Unreleased

- Project scaffold: module boundaries, interface stubs, synthetic fixture generator, CI.
- Geometry module (label positions, fit classification, centred placement, rotation for single-label media, PDF translation) and sheet definitions with vendor-cited margins: ll04 (Avery L7169 / Label Planet LP4/99), lp4-105, l7168, 6x4 thermal.
- Measurement: pdf.js raster at 72 dpi, ink bounds in mm relative to the MediaBox origin; ignores white backgrounds, clip paths and invisible text.
- Transform: source page embedded as a form XObject with an identity matrix and drawn by pure translation; 90 degree page rotation for single-label media; calibration page with crosshairs and mm rules at every label corner. Byte-level no-scaling proof in the test suite.
- README, before-and-after diagram, npm release workflow.
