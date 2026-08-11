# Cursor Usage Dashboard

Lightweight Cursor Canvas dashboard for `usage-events-*.csv` exports. Sparse KPIs, one daily cost trend, model mix, and a top-events table — nothing else.

## Privacy

Personal usage CSVs are **not** committed. `data/usage-events-*.csv` is gitignored except for the fake sample:

- Committed: `data/usage-events-sample.csv`
- Local only: your real `data/usage-events-YYYY-MM-DD.csv` exports

After syncing personal exports, **do not commit** `canvases/cursor-usage-overview.canvas.tsx` if it embeds private billing rows. Reset the catalog with only the sample before pushing, or discard canvas changes that contain personal data.

## Setup

```bash
# Drop a Cursor usage export into data/
# (Settings → Usage → export as usage-events-YYYY-MM-DD.csv)

npm run sync-canvas
```

Sync embeds every `data/usage-events-*.csv` into the canvas catalog and copies the file to Cursor’s managed canvases directory so the IDE can compile it beside chat.

## Open the dashboard

After sync, open:

`%USERPROFILE%\.cursor\projects\c-Users-Maahi-Projects-Agentic-Projects-Cursor-Usage-Visualization\canvases\cursor-usage-overview.canvas.tsx`

Use the **Source** dropdown to switch between embedded exports.

## Layout

```
Usage_Visualization/
├── data/
│   └── usage-events-sample.csv    # fake rows for a working demo
├── canvases/
│   └── cursor-usage-overview.canvas.tsx
├── scripts/
│   └── sync-canvas.mjs
├── package.json
└── README.md
```

## Notes

- Canvas files only import from `cursor/canvas` — no helpers, no runtime file reads.
- Edit the canvas in this repo, then run `npm run sync-canvas`.
- Do not move Cursor’s `.cursor/projects/...` tree into this folder.
