import {
  BarChart,
  Button,
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  LineChart,
  PieChart,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  useCanvasAction,
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
  avgCost: number;
  costPerM: number;
};

type KindAgg = {
  kind: string;
  events: number;
  cost: number;
  tokens: number;
  share: number;
};

type DayAgg = {
  date: string;
  label: string;
  events: number;
  cost: number;
  tokens: number;
  note: string;
};

type HourAgg = {
  hour: string;
  cost: number;
  events: number;
};

type TokenMix = {
  cacheWrite: number;
  input: number;
  cacheRead: number;
  output: number;
};

type ModelByDay = {
  categories: string[];
  series: { name: string; data: number[] }[];
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
  kinds: KindAgg[];
  tokenMix: TokenMix;
  peakHours: HourAgg[];
  peakHourSummary: string;
  modelByDay: ModelByDay;
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

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
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
  const tokenMix: TokenMix = {
    cacheWrite: 0,
    input: 0,
    cacheRead: 0,
    output: 0,
  };
  const eventDates: Date[] = [];
  const dayMap = new Map<string, DayAgg>();
  const modelMap = new Map<string, ModelAgg>();
  const kindMap = new Map<string, KindAgg>();
  const dayModelCost = new Map<string, Map<string, number>>();

  for (const row of billed) {
    const cost = numOr0(row["Cost"]);
    const tokens = numOr0(row["Total Tokens"]);
    const model = row["Model"] || "(unknown)";
    const kind = row["Kind"] || "(unknown)";
    const dt = new Date(row["Date"]);
    if (!Number.isNaN(dt.getTime())) eventDates.push(dt);

    totalCost += cost;
    totalTokens += tokens;
    tokenMix.cacheWrite += numOr0(row["Input (w/ Cache Write)"]);
    tokenMix.input += numOr0(row["Input (w/o Cache Write)"]);
    tokenMix.cacheRead += numOr0(row["Cache Read"]);
    tokenMix.output += numOr0(row["Output Tokens"]);

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
        note: "",
      };
      dayMap.set(dateKey, day);
    }
    day.events += 1;
    day.cost += cost;
    day.tokens += tokens;

    let m = modelMap.get(model);
    if (!m) {
      m = {
        model,
        events: 0,
        cost: 0,
        tokens: 0,
        avgCost: 0,
        costPerM: 0,
      };
      modelMap.set(model, m);
    }
    m.events += 1;
    m.cost += cost;
    m.tokens += tokens;

    let k = kindMap.get(kind);
    if (!k) {
      k = { kind, events: 0, cost: 0, tokens: 0, share: 0 };
      kindMap.set(kind, k);
    }
    k.events += 1;
    k.cost += cost;
    k.tokens += tokens;

    let dm = dayModelCost.get(dateKey);
    if (!dm) {
      dm = new Map();
      dayModelCost.set(dateKey, dm);
    }
    dm.set(model, (dm.get(model) ?? 0) + cost);
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const models = [...modelMap.values()]
    .map((m) => ({
      ...m,
      avgCost: m.events > 0 ? m.cost / m.events : 0,
      costPerM: m.tokens > 0 ? (m.cost / m.tokens) * 1_000_000 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
  const kinds = [...kindMap.values()]
    .map((k) => ({ ...k, share: pct(k.cost, totalCost) }))
    .sort((a, b) => b.cost - a.cost);

  const peakDay = days.reduce<DayAgg | null>(
    (best, d) => (!best || d.cost > best.cost ? d : best),
    null,
  );
  const peakShare = peakDay && totalCost > 0 ? pct(peakDay.cost, totalCost) : 0;
  const cacheShare = pct(tokenMix.cacheRead, totalTokens);
  const avgCost = billed.length > 0 ? totalCost / billed.length : 0;

  for (const day of days) {
    if (peakDay && day.date === peakDay.date) {
      day.note = `Peak — ${peakShare.toFixed(0)}% of spend`;
      continue;
    }
    const topModel = [...(dayModelCost.get(day.date)?.entries() ?? [])].sort(
      (a, b) => b[1] - a[1],
    )[0];
    if (topModel) {
      day.note = `${shortModel(topModel[0])} lead`;
    } else {
      day.note = "—";
    }
  }

  const peakHours: HourAgg[] = [];
  let peakHourSummary = "";
  if (peakDay) {
    const hourMap = new Map<string, HourAgg>();
    for (const row of billed) {
      const dt = new Date(row["Date"]);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt.toISOString().slice(0, 10) !== peakDay.date) continue;
      const hour = `${String(dt.getUTCHours()).padStart(2, "0")}:00`;
      let h = hourMap.get(hour);
      if (!h) {
        h = { hour, cost: 0, events: 0 };
        hourMap.set(hour, h);
      }
      h.cost += numOr0(row["Cost"]);
      h.events += 1;
    }
    peakHours.push(
      ...[...hourMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    );
    const busiest = [...peakHours].sort((a, b) => b.cost - a.cost)[0];
    if (busiest) {
      peakHourSummary = `Hour ${busiest.hour} UTC led with ${formatMoney(busiest.cost)} across ${busiest.events} event${busiest.events === 1 ? "" : "s"}.`;
    }
  }

  const modelByDay: ModelByDay = {
    categories: days.map((d) => d.label),
    series: models.map((m) => ({
      name: shortModel(m.model),
      data: days.map(
        (d) =>
          Math.round((dayModelCost.get(d.date)?.get(m.model) ?? 0) * 100) / 100,
      ),
    })),
  };

  const topEvents = [...billed]
    .sort((a, b) => numOr0(b["Cost"]) - numOr0(a["Cost"]))
    .slice(0, 8);

  const notes: string[] = [];
  if (errored > 0) {
    notes.push(
      `${errored} event${errored === 1 ? "" : "s"} Kind "Errored, No Charge" excluded from billed totals`,
    );
  }
  if (tokenMix.cacheWrite === 0) {
    notes.push("No cache-write input in this export");
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
      kinds,
      tokenMix,
      peakHours,
      peakHourSummary,
      modelByDay,
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

function Band({
  kicker,
  title,
  caption,
}: {
  kicker?: string;
  title: string;
  caption: string;
}) {
  return (
    <Stack gap={8}>
      {kicker ? (
        <Text
          tone="tertiary"
          size="small"
          weight="medium"
          style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          {kicker}
        </Text>
      ) : null}
      <H2 style={{ letterSpacing: "-0.03em" }}>{title}</H2>
      <Text tone="tertiary" size="small" style={{ maxWidth: 520, lineHeight: 1.5 }}>
        {caption}
      </Text>
    </Stack>
  );
}

export default function CursorUsageOverview() {
  const theme = useHostTheme();
  const dispatch = useCanvasAction();
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
  const avgDayCost =
    data && data.days.length > 0 ? data.totalCost / data.days.length : 0;
  const leadModel = data?.models[0];
  const leanModel =
    data && data.models.length > 0
      ? [...data.models].sort((a, b) => a.costPerM - b.costPerM)[0]
      : null;
  const leadKind = data?.kinds[0];

  const tokenMixSlices = data
    ? [
        {
          label: "Cache read",
          value: data.tokenMix.cacheRead,
          tone: "info" as const,
        },
        {
          label: "Input",
          value: data.tokenMix.input,
          tone: "neutral" as const,
        },
        {
          label: "Output",
          value: data.tokenMix.output,
          tone: "warning" as const,
        },
        ...(data.tokenMix.cacheWrite > 0
          ? [
              {
                label: "Cache write",
                value: data.tokenMix.cacheWrite,
                tone: "success" as const,
              },
            ]
          : []),
      ].filter((s) => s.value > 0)
    : [];

  const hairline = `1px solid ${theme.stroke.tertiary}`;

  return (
    <Stack
      gap={0}
      style={{
        padding: "64px 72px 80px",
        maxWidth: 920,
        background: theme.bg.editor,
      }}
    >
      <Grid columns="1fr auto" gap={32} align="start">
        <Stack gap={12}>
          <Text
            tone="tertiary"
            size="small"
            weight="medium"
            style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
          >
            Cursor
          </Text>
          <H1 style={{ letterSpacing: "-0.04em" }}>Usage</H1>
          <Text tone="secondary" style={{ maxWidth: 440, lineHeight: 1.55 }}>
            What this export spent, and where.
          </Text>
        </Stack>
        <Stack gap={8} style={{ minWidth: 260, paddingTop: 28 }}>
          <Text
            tone="tertiary"
            size="small"
            style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Source
          </Text>
          <Select
            value={entry?.filename ?? ""}
            onChange={setSelectedFile}
            options={options}
            placeholder="Choose a usage CSV…"
            style={{ minWidth: 260 }}
          />
          {entry ? (
            <Button
              variant="ghost"
              onClick={() =>
                dispatch({
                  type: "openFile",
                  path: `data/${entry.filename}`,
                })
              }
            >
              Open CSV
            </Button>
          ) : null}
        </Stack>
      </Grid>

      {!result.ok ? (
        <>
          <Divider style={{ marginTop: 48, marginBottom: 32 }} />
          <Callout tone="danger" title="Could not load usage data">
            {result.error} Pick another file from Source, or run `npm run sync-canvas`
            after adding a CSV.
          </Callout>
        </>
      ) : null}

      {data && data.billedEvents === 0 ? (
        <>
          <Divider style={{ marginTop: 48, marginBottom: 32 }} />
          <Callout tone="warning" title="No billed events">
            {source} parsed, but every row is Kind "Errored, No Charge."
          </Callout>
        </>
      ) : null}

      {data && data.billedEvents > 0 ? (
        <>
          <Stack gap={8} style={{ marginTop: 28 }}>
            <Text tone="quaternary" size="small">
              {range} · {data.billedEvents} billed
              {data.erroredEvents > 0 ? ` · ${data.erroredEvents} errored` : ""} ·{" "}
              {source}
            </Text>
          </Stack>

          <Divider style={{ marginTop: 48, marginBottom: 48 }} />

          <Grid columns={4} gap={32}>
            <Stat value={formatMoney(data.totalCost)} label="Total cost" />
            <Stat value={formatTokens(data.totalTokens)} label="Tokens" />
            <Stat value={String(data.billedEvents)} label="Billed events" />
            <Stat
              value={data.peakDay ? formatMoney(data.peakDay.cost) : "—"}
              label={data.peakDay ? `Peak · ${data.peakDay.label}` : "Peak day"}
            />
          </Grid>
          <Text
            tone="tertiary"
            size="small"
            style={{ marginTop: 20, maxWidth: 640, lineHeight: 1.55 }}
          >
            {formatMoney(avgDayCost)} average day
            {leadModel
              ? ` · ${shortModel(leadModel.model)} is ${pct(leadModel.cost, data.totalCost).toFixed(0)}% of spend`
              : ""}
            {` · cache reads ${data.cacheShare.toFixed(0)}% of tokens`}
            {leadKind ? ` · ${leadKind.kind}` : ""}
            {` · ${formatMoney(data.avgCost, 3)} per event`}.
          </Text>

          <Divider style={{ marginTop: 56, marginBottom: 48 }} />

          <Stack gap={24}>
            <Band
              kicker="01"
              title="Daily"
              caption={`Cost ($) and tokens (millions) by calendar day. Average day ${formatMoney(avgDayCost)}. Source: ${source} · ${range}.`}
            />
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
              height={240}
              fill
              showValues={data.days.length <= 8}
              referenceLines={[
                { value: avgDayCost, label: "Avg", tone: "neutral" },
              ]}
            />
            <LineChart
              categories={data.days.map((d) => d.label)}
              series={[
                {
                  name: "Tokens (M)",
                  data: data.days.map(
                    (d) => Math.round((d.tokens / 1_000_000) * 100) / 100,
                  ),
                  tone: "neutral",
                },
              ]}
              valueSuffix="M"
              height={180}
              fill
              showValues={data.days.length <= 8}
            />
          </Stack>

          <Divider style={{ marginTop: 56, marginBottom: 48 }} />

          <Stack gap={24}>
            <Band
              kicker="02"
              title="Models"
              caption={`Share of ${formatMoney(data.totalCost)}. Bars are billed cost ($). Source: ${source} · ${range}.`}
            />
            <BarChart
              categories={data.models.map((m) => shortModel(m.model))}
              series={[
                {
                  name: "Cost ($)",
                  data: data.models.map((m) => Math.round(m.cost * 100) / 100),
                },
              ]}
              horizontal
              valuePrefix="$"
              height={Math.min(220, 56 + data.models.length * 36)}
              showValues
            />
            {data.models.length > 1 && data.modelByDay.categories.length > 0 ? (
              <BarChart
                categories={data.modelByDay.categories}
                series={data.modelByDay.series}
                stacked
                valuePrefix="$"
                height={220}
              />
            ) : null}
            <Table
              framed={false}
              striped={false}
              headers={["Model", "Events", "Cost", "$/1M"]}
              rows={data.models.map((m) => [
                shortModel(m.model),
                String(m.events),
                formatMoney(m.cost),
                formatMoney(m.costPerM),
              ])}
              columnAlign={["left", "right", "right", "right"]}
            />
            {leadModel && leanModel ? (
              <Text tone="tertiary" size="small" style={{ lineHeight: 1.5 }}>
                {shortModel(leanModel.model)} is the most token-efficient at{" "}
                {formatMoney(leanModel.costPerM)} / 1M.
              </Text>
            ) : null}
          </Stack>

          <Divider style={{ marginTop: 56, marginBottom: 48 }} />

          <Grid columns={2} gap={48} align="start">
            <Stack gap={20}>
              <Band
                kicker="03"
                title="Tokens"
                caption={`${formatTokens(data.totalTokens)} billed tokens. Cache vs input vs output.`}
              />
              {tokenMixSlices.length > 0 ? (
                <PieChart data={tokenMixSlices} donut size={180} />
              ) : null}
              <Table
                framed={false}
                striped={false}
                headers={["Type", "Tokens", "Share"]}
                rows={[
                  [
                    "Cache read",
                    formatTokens(data.tokenMix.cacheRead),
                    `${pct(data.tokenMix.cacheRead, data.totalTokens).toFixed(1)}%`,
                  ],
                  [
                    "Input",
                    formatTokens(data.tokenMix.input),
                    `${pct(data.tokenMix.input, data.totalTokens).toFixed(1)}%`,
                  ],
                  ...(data.tokenMix.cacheWrite > 0
                    ? [
                        [
                          "Cache write",
                          formatTokens(data.tokenMix.cacheWrite),
                          `${pct(data.tokenMix.cacheWrite, data.totalTokens).toFixed(1)}%`,
                        ],
                      ]
                    : []),
                  [
                    "Output",
                    formatTokens(data.tokenMix.output),
                    `${pct(data.tokenMix.output, data.totalTokens).toFixed(1)}%`,
                  ],
                ]}
                columnAlign={["left", "right", "right"]}
              />
            </Stack>

            {data.models.length > 1 ? (
              <Stack gap={20}>
                <Band
                  kicker="04"
                  title="Efficiency"
                  caption="Billed cost per 1 million tokens, by model. Lower is leaner."
                />
                <BarChart
                  categories={data.models.map((m) => shortModel(m.model))}
                  series={[
                    {
                      name: "Cost per 1M tokens ($)",
                      data: data.models.map(
                        (m) => Math.round(m.costPerM * 100) / 100,
                      ),
                      tone: "neutral",
                    },
                  ]}
                  horizontal
                  valuePrefix="$"
                  height={Math.min(200, 56 + data.models.length * 36)}
                  showValues
                />
              </Stack>
            ) : null}
          </Grid>

          {data.peakDay && data.peakHours.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="05"
                  title={`Peak · ${data.peakDay.label}`}
                  caption={`${formatMoney(data.peakDay.cost)} · ${data.peakDay.events} events · ${formatTokens(data.peakDay.tokens)} tokens · ${data.peakShare.toFixed(0)}% of spend. Hourly cost ($) in UTC. Source: ${source}.`}
                />
                {data.peakHourSummary ? (
                  <Text tone="secondary" style={{ maxWidth: 560, lineHeight: 1.55 }}>
                    {data.peakHourSummary}
                  </Text>
                ) : null}
                <BarChart
                  categories={data.peakHours.map((h) => h.hour)}
                  series={[
                    {
                      name: "Cost ($)",
                      data: data.peakHours.map(
                        (h) => Math.round(h.cost * 100) / 100,
                      ),
                      tone: "warning",
                    },
                  ]}
                  valuePrefix="$"
                  height={200}
                  showValues={data.peakHours.length <= 8}
                />
              </Stack>
            </>
          ) : null}

          {data.kinds.length > 1 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="06"
                  title="Kind"
                  caption={`Express vs free (and other billed kinds). Bars are cost ($). Source: ${source} · ${range}.`}
                />
                <BarChart
                  categories={data.kinds.map((k) => k.kind)}
                  series={[
                    {
                      name: "Cost ($)",
                      data: data.kinds.map((k) => Math.round(k.cost * 100) / 100),
                    },
                  ]}
                  horizontal
                  valuePrefix="$"
                  height={Math.min(160, 56 + data.kinds.length * 36)}
                  showValues
                />
                <Table
                  framed={false}
                  striped={false}
                  headers={["Kind", "Events", "Cost", "Share"]}
                  rows={data.kinds.map((k) => [
                    k.kind,
                    String(k.events),
                    formatMoney(k.cost),
                    `${k.share.toFixed(0)}%`,
                  ])}
                  columnAlign={["left", "right", "right", "right"]}
                />
              </Stack>
            </>
          ) : null}

          <Divider style={{ marginTop: 56, marginBottom: 48 }} />

          <Stack gap={24}>
            <Band
              kicker="07"
              title="Highest-cost events"
              caption={`Top ${data.topEvents.length} by Cost. Times in UTC. Source: ${source} · ${range}.`}
            />
            <Table
              framed={false}
              striped={false}
              headers={["When", "Model", "Kind", "Tokens", "Cost"]}
              rows={data.topEvents.map((r) => [
                eventWhen(r["Date"]),
                shortModel(r["Model"]),
                r["Kind"],
                formatTokens(parseNumber(r["Total Tokens"]) || 0),
                formatMoney(parseNumber(r["Cost"]) || 0),
              ])}
              columnAlign={["left", "left", "left", "right", "right"]}
            />
          </Stack>

          {data.days.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="08"
                  title="By day"
                  caption={`Calendar-day rollup. Source: ${source} · ${range}.`}
                />
                <Table
                  framed={false}
                  striped={false}
                  headers={["Date", "Events", "Cost", "Tokens"]}
                  rows={data.days.map((d) => [
                    d.date,
                    String(d.events),
                    formatMoney(d.cost),
                    formatTokens(d.tokens),
                  ])}
                  columnAlign={["left", "right", "right", "right"]}
                  rowTone={data.days.map((d) =>
                    data.peakDay && d.date === data.peakDay.date
                      ? ("warning" as const)
                      : undefined,
                  )}
                />
              </Stack>
            </>
          ) : null}

          <Text
            tone="quaternary"
            size="small"
            style={{
              borderTop: hairline,
              marginTop: 64,
              paddingTop: 24,
              lineHeight: 1.55,
            }}
          >
            Totals from {source}
            {data.notes.length > 0 ? ` · ${data.notes.join("; ")}` : ""}. Sync
            with `npm run sync-canvas` after adding usage-events-*.csv files.
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
