import {
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  LineChart,
  PieChart,
  Pill,
  Row,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

/** Workspace usage-events CSVs discovered at author time (canvas cannot list/read files at runtime). */
const CSV_CATALOG: { filename: string; text: string }[] = [{"filename":"usage-events-sample.csv","text":"Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n\"2026-08-10T14:22:11.000Z\",\"\",\"\",\"express\",\"cursor-grok-4.5-medium\",\"No\",\"0\",\"12000\",\"180000\",\"800\",\"192800\",\"0.42\"\n\"2026-08-10T11:05:44.000Z\",\"\",\"\",\"express\",\"composer-2.5\",\"No\",\"0\",\"45000\",\"220000\",\"3200\",\"268200\",\"0.18\"\n\"2026-08-09T18:40:02.000Z\",\"\",\"\",\"express\",\"cursor-grok-4.5-medium\",\"No\",\"0\",\"8800\",\"95000\",\"640\",\"104440\",\"0.21\"\n\"2026-08-09T09:12:55.000Z\",\"\",\"\",\"express\",\"composer-2.5\",\"No\",\"0\",\"31000\",\"140000\",\"2100\",\"173100\",\"0.12\"\n\"2026-08-08T16:33:19.000Z\",\"\",\"\",\"express\",\"cursor-grok-4.5-medium\",\"No\",\"0\",\"15200\",\"410000\",\"1900\",\"427100\",\"0.55\"\n\"2026-08-08T10:01:07.000Z\",\"\",\"\",\"free\",\"composer-2.5-fast\",\"No\",\"0\",\"22000\",\"88000\",\"900\",\"110900\",\"0.09\"\n\"2026-08-07T20:15:41.000Z\",\"\",\"\",\"express\",\"cursor-grok-4.5-medium\",\"No\",\"0\",\"6700\",\"52000\",\"410\",\"59110\",\"0.14\"\n\"2026-08-07T08:48:26.000Z\",\"\",\"\",\"Errored, No Charge\",\"cursor-grok-4.5-medium\",\"No\",\"\",\"\",\"\",\"\",\"\",\"Free\"\n"}];

const REQUIRED_COLUMNS = [
  "Date",
  "Kind",
  "Model",
  "Input (w/ Cache Write)",
  "Input (w/o Cache Write)",
  "Cache Read",
  "Output Tokens",
  "Total Tokens",
  "Cost",
] as const;

type CsvRow = Record<string, string>;

type ModelAgg = {
  model: string;
  events: number;
  cost: number;
  tokens: number;
};

type DayAgg = {
  date: string;
  label: string;
  events: number;
  cost: number;
  tokens: number;
};

type Dashboard = {
  filename: string;
  rangeLabel: string;
  allEvents: number;
  billedEvents: number;
  erroredEvents: number;
  totalCost: number;
  totalTokens: number;
  avgCost: number;
  cacheShare: number;
  peakDay: DayAgg | null;
  peakShare: number;
  days: DayAgg[];
  models: ModelAgg[];
  topEvents: CsvRow[];
  notes: string[];
};

function defaultFilename(): string {
  const usage = CSV_CATALOG.filter((c) =>
    /^usage-events-.*\.csv$/i.test(c.filename),
  ).sort((a, b) => b.filename.localeCompare(a.filename));
  if (usage.length > 0) return usage[0].filename;
  return CSV_CATALOG[0]?.filename ?? "";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatMoney(n: number, digits = 2): string {
  return `$${n.toFixed(digits)}`;
}

function shortModel(model: string): string {
  return model.replace(/^cursor-/, "");
}

function parseNumber(raw: string | undefined): number {
  const s = (raw ?? "").trim();
  if (s === "") return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseCsv(
  text: string,
): { headers: string[]; rows: CsvRow[] } | { error: string } {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (normalized.trim() === "") {
    return { error: "The selected file is empty." };
  }

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  if (rows.length === 0) return { error: "The selected file is empty." };
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((cells) => {
    const obj: CsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = cells[i] ?? "";
    }
    return obj;
  });
  return { headers, rows: dataRows };
}

function monthDay(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function monthDayYear(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRange(dates: Date[]): string {
  if (dates.length === 0) return "No dates";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  if (a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)) {
    return monthDayYear(a);
  }
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  if (sameYear) {
    return `${monthDay(a)} – ${monthDayYear(b)}`;
  }
  return `${monthDayYear(a)} – ${monthDayYear(b)}`;
}

function analyze(
  filename: string,
  text: string,
): { ok: true; data: Dashboard } | { ok: false; error: string } {
  const parsed = parseCsv(text);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const missing = REQUIRED_COLUMNS.filter((col) => !parsed.headers.includes(col));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing expected columns: ${missing.join(", ")}.`,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "The CSV has a header but no data rows." };
  }

  const billed = parsed.rows.filter((r) => r["Kind"] !== "Errored, No Charge");
  const errored = parsed.rows.length - billed.length;

  const numOr0 = (raw: string) => {
    const n = parseNumber(raw);
    return Number.isFinite(n) ? n : 0;
  };

  let totalCost = 0;
  let totalTokens = 0;
  let cacheRead = 0;
  const eventDates: Date[] = [];
  const dayMap = new Map<string, DayAgg>();
  const modelMap = new Map<string, ModelAgg>();

  for (const row of billed) {
    const cost = numOr0(row["Cost"]);
    const tokens = numOr0(row["Total Tokens"]);
    const cr = numOr0(row["Cache Read"]);
    const model = row["Model"] || "(unknown)";
    const dt = new Date(row["Date"]);
    if (!Number.isNaN(dt.getTime())) eventDates.push(dt);

    totalCost += cost;
    totalTokens += tokens;
    cacheRead += cr;

    const dateKey = Number.isNaN(dt.getTime())
      ? "unknown"
      : dt.toISOString().slice(0, 10);
    const dayLabel = Number.isNaN(dt.getTime()) ? "Unknown" : monthDay(dt);
    let day = dayMap.get(dateKey);
    if (!day) {
      day = {
        date: dateKey,
        label: dayLabel,
        events: 0,
        cost: 0,
        tokens: 0,
      };
      dayMap.set(dateKey, day);
    }
    day.events += 1;
    day.cost += cost;
    day.tokens += tokens;

    let m = modelMap.get(model);
    if (!m) {
      m = { model, events: 0, cost: 0, tokens: 0 };
      modelMap.set(model, m);
    }
    m.events += 1;
    m.cost += cost;
    m.tokens += tokens;
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const models = [...modelMap.values()].sort((a, b) => b.cost - a.cost);
  const peakDay = days.reduce<DayAgg | null>(
    (best, d) => (!best || d.cost > best.cost ? d : best),
    null,
  );
  const peakShare = peakDay && totalCost > 0 ? (peakDay.cost / totalCost) * 100 : 0;
  const cacheShare = totalTokens > 0 ? (cacheRead / totalTokens) * 100 : 0;
  const avgCost = billed.length > 0 ? totalCost / billed.length : 0;

  const topEvents = [...billed]
    .sort((a, b) => numOr0(b["Cost"]) - numOr0(a["Cost"]))
    .slice(0, 8);

  const notes: string[] = [];
  if (errored > 0) {
    notes.push(
      `${errored} event${errored === 1 ? "" : "s"} Kind "Errored, No Charge" excluded from billed totals`,
    );
  }

  return {
    ok: true,
    data: {
      filename,
      rangeLabel: formatRange(eventDates),
      allEvents: parsed.rows.length,
      billedEvents: billed.length,
      erroredEvents: errored,
      totalCost,
      totalTokens,
      avgCost,
      cacheShare,
      peakDay,
      peakShare,
      days,
      models,
      topEvents,
      notes,
    },
  };
}

function eventWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${monthDay(d)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export default function CursorUsageOverview() {
  const theme = useHostTheme();
  const [selectedFile, setSelectedFile] = useCanvasState(
    "csvSourceFilename",
    defaultFilename(),
  );

  const options = CSV_CATALOG.map((c) => ({
    value: c.filename,
    label: c.filename,
  }));

  const entry =
    CSV_CATALOG.find((c) => c.filename === selectedFile) ??
    CSV_CATALOG.find((c) => c.filename === defaultFilename()) ??
    CSV_CATALOG[0];

  const result = entry
    ? analyze(entry.filename, entry.text)
    : {
        ok: false as const,
        error: "No usage CSV is available in the workspace catalog.",
      };

  const data = result.ok ? result.data : null;
  const source = data?.filename ?? selectedFile ?? "—";
  const range = data?.rangeLabel ?? "—";

  return (
    <Stack
      gap={32}
      style={{
        padding: 32,
        maxWidth: 920,
        background: theme.bg.editor,
      }}
    >
      <Stack gap={16}>
        <Stack gap={6}>
          <H1>Cursor usage</H1>
          <Text tone="secondary">
            Cost and token overview from local usage-events exports
          </Text>
        </Stack>

        <Row gap={12} align="center" wrap>
          <Text tone="secondary" size="small">
            Source
          </Text>
          <Select
            value={entry?.filename ?? ""}
            onChange={setSelectedFile}
            options={options}
            placeholder="Choose a usage CSV…"
            style={{ minWidth: 260 }}
          />
          {data ? (
            <Row gap={6} wrap>
              <Pill size="sm">{range}</Pill>
              <Pill size="sm">{data.allEvents} events</Pill>
            </Row>
          ) : null}
        </Row>
      </Stack>

      {!result.ok ? (
        <Callout tone="danger" title="Could not load usage data">
          {result.error} Pick another file from the Source dropdown, or run{" "}
          <Text weight="semibold">npm run sync-canvas</Text> after adding a CSV.
        </Callout>
      ) : null}

      {data && data.billedEvents === 0 ? (
        <Callout tone="warning" title="No billed events">
          {source} parsed successfully but has no billable rows after excluding
          Errored, No Charge.
        </Callout>
      ) : null}

      {data && data.billedEvents > 0 ? (
        <>
          <Grid columns={4} gap={16}>
            <Stat value={formatMoney(data.totalCost)} label="Total cost" />
            <Stat value={formatTokens(data.totalTokens)} label="Total tokens" />
            <Stat value={String(data.billedEvents)} label="Billed events" />
            <Stat
              value={data.peakDay ? formatMoney(data.peakDay.cost) : "—"}
              label={
                data.peakDay
                  ? `Peak · ${data.peakDay.label}`
                  : "Peak day"
              }
              tone="warning"
            />
          </Grid>

          <Stack gap={10}>
            <Stack gap={4}>
              <H2>Daily cost</H2>
              <Text tone="tertiary" size="small">
                Cost ($) by day · Source: {source} · {range} · avg{" "}
                {formatMoney(data.totalCost / Math.max(data.days.length, 1))}
              </Text>
            </Stack>
            <LineChart
              categories={data.days.map((d) => d.label)}
              series={[
                {
                  name: "Cost ($)",
                  data: data.days.map((d) => Math.round(d.cost * 100) / 100),
                  tone: "info",
                },
              ]}
              valuePrefix="$"
              height={260}
              fill
              referenceLines={[
                {
                  value: data.totalCost / Math.max(data.days.length, 1),
                  label: "Avg day",
                  tone: "neutral",
                },
              ]}
            />
          </Stack>

          <Divider />

          <Grid columns="1fr 1.2fr" gap={28} align="start">
            <Stack gap={10}>
              <Stack gap={4}>
                <H2>Model mix</H2>
                <Text tone="tertiary" size="small">
                  Share of {formatMoney(data.totalCost)} spend · Source: {source}
                </Text>
              </Stack>
              <PieChart
                data={data.models.map((m) => ({
                  label: `${shortModel(m.model)} · ${formatMoney(m.cost)}`,
                  value: Math.round(m.cost * 100) / 100,
                }))}
                donut
                size={200}
              />
            </Stack>

            <Stack gap={10}>
              <Stack gap={4}>
                <H2>By model</H2>
                <Text tone="tertiary" size="small">
                  Events, cost, and tokens · Source: {source}
                </Text>
              </Stack>
              <Table
                headers={["Model", "Events", "Cost", "Tokens"]}
                rows={data.models.map((m) => [
                  shortModel(m.model),
                  String(m.events),
                  formatMoney(m.cost),
                  formatTokens(m.tokens),
                ])}
                columnAlign={["left", "right", "right", "right"]}
                striped
              />
            </Stack>
          </Grid>

          <Divider />

          <Stack gap={10}>
            <Stack gap={4}>
              <H2>Top events</H2>
              <Text tone="tertiary" size="small">
                Highest cost · Top {data.topEvents.length} · Source: {source} ·{" "}
                {range}
              </Text>
            </Stack>
            <Table
              headers={["When (UTC)", "Model", "Kind", "Tokens", "Cost"]}
              rows={data.topEvents.map((r) => [
                eventWhen(r["Date"]),
                shortModel(r["Model"]),
                r["Kind"],
                formatTokens(parseNumber(r["Total Tokens"]) || 0),
                formatMoney(parseNumber(r["Cost"]) || 0),
              ])}
              columnAlign={["left", "left", "left", "right", "right"]}
              striped
            />
          </Stack>

          <Text
            tone="quaternary"
            size="small"
            style={{
              borderTop: `1px solid ${theme.stroke.tertiary}`,
              paddingTop: 16,
            }}
          >
            Totals from {source}
            {data.peakDay
              ? ` · Peak ${data.peakDay.label} is ${data.peakShare.toFixed(0)}% of spend`
              : ""}
            {data.cacheShare > 0
              ? ` · Cache read ${data.cacheShare.toFixed(0)}% of tokens`
              : ""}
            {` · Avg ${formatMoney(data.avgCost, 3)}/event`}
            {data.notes.length > 0 ? ` · ${data.notes.join("; ")}` : ""}. Run{" "}
            npm run sync-canvas after adding usage-events-*.csv files.
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
