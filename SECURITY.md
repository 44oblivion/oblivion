# Security notes

Do not include API keys, cookies, delivery codes, exported settings, or customer messages in public issues. Report a suspected security problem through a private GitHub security advisory when available.

The release ZIP has no npm/runtime dependencies, remote JavaScript, `eval`, or telemetry. It contains only the extension source and its small brand icons. Optional AI and notification traffic requires both the corresponding host permissions and Firefox data-consent permissions.

At the initial 2026-10-22 development audit, npm reported GHSA-86w9-cpqp-85rv in `node-forge`, inherited through `web-ext` → `@devicefarmer/adbkit`. The registry offered no fixed `node-forge` release at audit time. This dependency is used by development tooling, not included in the extension ZIP. Firefox tests do not use Android/ADB or RSA verification. The advisory is tracked rather than hidden by suppressing audit output; update the toolchain when a fix becomes available.

Reference: https://github.com/advisories/GHSA-86w9-cpqp-85rv
