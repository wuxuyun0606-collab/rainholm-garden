# Release checks — 2026-09-19

This release was prepared from a supplied standalone garden snapshot.

- Reviewed source, configuration, example data, bundled documentation, asset metadata and six documentation screenshots for private data. No unresolved credential or personal-data findings remained in the release candidate. Pattern scans are not a guarantee that every possible secret can be detected.
- Removed private production notes and quoted conversations from first-party comments and asset handoff notes. Comment cleanup preserved JavaScript syntax trees and CSS rules.
- Kept only the example save. Runtime saves, local environment files, private keys, logs and machine files are excluded by `.gitignore`.
- Compared all 88 bundled `vendor/aifarm` files against upstream commit `03c307408075dccdcb0ac2c65a543189655873f7`: every file matched.
- Added the PixiJS MIT license text and Noto font notices; clarified the scope of original-code MIT licensing and the separate cat-character terms.
- Added browser Origin / Fetch Metadata checks, JSON-only API writes and loopback Host validation. Command-line AI clients can still call the local service without Origin. The service remains a single-user application without authentication.
- Passed the standalone server integration tests, upstream smoke tests and upstream adapter parity checks. Checked JavaScript syntax and JSON parsing.
- Manually opened the garden, greenhouse, cat home and credits dialog in a browser; no warnings or errors were reported in the browser console during that check.

The bundled engine uses PolyForm Noncommercial 1.0.0. This is a public,
source-available noncommercial distribution, not an all-MIT or OSI-open-source
distribution. See `LICENSE` and `NOTICE` for component-specific terms.
