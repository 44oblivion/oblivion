# Architecture

Oblivion is an original Firefox Manifest V2 WebExtension. A persistent background page holds the stateful job engine, DOM parser and IndexedDB access. The content workspace uses a closed shadow root, escaped text and an inert-DOM sanitizer; it does not expose a webpage message bridge. The separate offline preview deliberately opens its shadow root for inspection and uses fictional fixtures.

`shared/core.js` contains pure normalization, matching, date/price parsing and export utilities. `background/storage.js` contains callback-compatible WebExtension storage and IndexedDB. `background/funpay.js` isolates the mutable website contract. It validates destinations, uses the current session, carries CSRF tokens and serializes mutations with pacing. It never blindly retries an uncertain write.

`background/engine.js` tracks progress per FunPay account. Enabled rules/inventories receive a baseline so pre-existing events do not trigger retroactive actions. A delivery removes stock into a durable reservation before sending. An uncertain response stays reserved for manual resolution. Stop requests are checked before subsequent work; late stock persistence cannot re-enable a paused inventory.

`background/main.js` accepts only own-extension messages from extension URLs or allowed FunPay origins, checks own command names, and serializes preference edits. `content/workspace.js` implements the eight-page workspace. `content/page-tools.js` contains small original tools attached to native pages. The popup opens the workspace or pauses jobs.

External credentials are local, destinations are fixed, and external permissions/data-consent are checked before requests. The runtime has no npm dependencies. All npm dependencies are development tools. Workflow actions are pinned to immutable commits.

This design does not turn FunPay's mutable website contract into a stable API. Fixtures and smoke tests complement, rather than replace, authenticated end-to-end checks.
