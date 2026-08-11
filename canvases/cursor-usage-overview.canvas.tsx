import {
  BarChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  LineChart,
  PieChart,
  Pill,
  Row,
  Select,
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
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
  topEvents: CsvRow[];
  modelSeries: { name: string; data: number[] }[];
  notes: string[];
};

const USAGE_COLORS = ["blue", "orange", "green", "yellow", "gray"] as const;

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

  const topModels = models.slice(0, 5);
  const modelSeries = topModels.map((m) => ({
    name: shortModel(m.model),
    data: days.map((d) => {
      const v = dayModelCost.get(d.date)?.get(m.model) ?? 0;
      return Math.round(v * 100) / 100;
    }),
  }));

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
      topEvents,
      modelSeries,
      notes,
    },
  };
}

function eventWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${monthDay(d)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function SectionLabel({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <Stack gap={6}>
      <H2>{title}</H2>
      <Text tone="tertiary" size="small">
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

  const tokenMixSlices = data
    ? [
        {
          label: `Cache read · ${pct(data.tokenMix.cacheRead, data.totalTokens).toFixed(1)}%`,
          value: data.tokenMix.cacheRead,
          tone: "info" as const,
        },
        {
          label: `Input · ${pct(data.tokenMix.input, data.totalTokens).toFixed(1)}%`,
          value: data.tokenMix.input,
          tone: "neutral" as const,
        },
        {
          label: `Output · ${pct(data.tokenMix.output, data.totalTokens).toFixed(1)}%`,
          value: data.tokenMix.output,
          tone: "warning" as const,
        },
        ...(data.tokenMix.cacheWrite > 0
          ? [
              {
                label: `Cache write · ${pct(data.tokenMix.cacheWrite, data.totalTokens).toFixed(1)}%`,
                value: data.tokenMix.cacheWrite,
                tone: "success" as const,
              },
            ]
          : []),
      ].filter((s) => s.value > 0)
    : [];

  return (
    <Stack
      gap={40}
      style={{
        padding: "40px 44px 48px",
        maxWidth: 1040,
        background: theme.bg.editor,
      }}
    >
      {/* Hero — product title + quiet meta */}
      <Stack gap={20}>
        <Stack gap={8}>
          <Text
            tone="tertiary"
            size="small"
            weight="medium"
            style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Cursor
          </Text>
          <H1 style={{ letterSpacing: "-0.02em" }}>Usage</H1>
          <Text tone="secondary" style={{ maxWidth: 520, lineHeight: 1.5 }}>
            Cost, tokens, and model mix from local usage-events exports —
            editorial overview, not a billing console.
          </Text>
        </Stack>

        <Row gap={12} align="center" justify="space-between" wrap>
          <Row gap={10} align="center" wrap>
            <Text tone="tertiary" size="small">
              Source
            </Text>
            <Select
              value={entry?.filename ?? ""}
              onChange={setSelectedFile}
              options={options}
              placeholder="Choose a usage CSV…"
              style={{ minWidth: 280 }}
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
          </Row>
          {data ? (
            <Row gap={8} align="center" wrap>
              <Pill active size="sm">
                {range}
              </Pill>
              <Text tone="quaternary" size="small">
                {data.allEvents} events · {source}
              </Text>
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
          {/* KPI strip */}
          <Grid columns={4} gap={20}>
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

          {data.peakDay && data.peakShare >= 35 ? (
            <Callout tone="neutral" title={`${data.peakDay.label} carries most of the spend`}>
              {data.peakDay.label} is {formatMoney(data.peakDay.cost)} of{" "}
              {formatMoney(data.totalCost)} ({data.peakShare.toFixed(0)}%) across{" "}
              {data.peakDay.events} events. Cache reads are{" "}
              {data.cacheShare.toFixed(0)}% of token volume. Average{" "}
              {formatMoney(data.avgCost, 3)} per billed event.
            </Callout>
          ) : (
            <Callout tone="neutral" title="Export snapshot">
              Cache reads are {data.cacheShare.toFixed(0)}% of token volume.
              Average {formatMoney(data.avgCost, 3)} per billed event ·{" "}
              {data.days.length} active day{data.days.length === 1 ? "" : "s"}.
            </Callout>
          )}

          {/* Primary trend */}
          <Stack gap={16}>
            <SectionLabel
              title="Daily trend"
              caption={`Cost and volume by calendar day · Source: ${source} · ${range}`}
            />
            <Grid columns="1.45fr 1fr" gap={28} align="start">
              <Stack gap={10}>
                <Stack gap={4}>
                  <H3>Daily cost</H3>
                  <Text tone="tertiary" size="small">
                    Cost ($) · Date · avg day {formatMoney(avgDayCost)}
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
                  showValues={data.days.length <= 10}
                  referenceLines={[
                    {
                      value: avgDayCost,
                      label: "Avg day",
                      tone: "neutral",
                    },
                  ]}
                />
              </Stack>

              <Stack gap={22}>
                <Stack gap={10}>
                  <Stack gap={4}>
                    <H3>Daily tokens</H3>
                    <Text tone="tertiary" size="small">
                      Tokens (millions) · Date
                    </Text>
                  </Stack>
                  <BarChart
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
                    height={160}
                    valueSuffix="M"
                    showValues={data.days.length <= 10}
                  />
                </Stack>
                <Stack gap={10}>
                  <Stack gap={4}>
                    <H3>Events per day</H3>
                    <Text tone="tertiary" size="small">
                      Event count · Date
                    </Text>
                  </Stack>
                  <BarChart
                    categories={data.days.map((d) => d.label)}
                    series={[
                      {
                        name: "Events",
                        data: data.days.map((d) => d.events),
                      },
                    ]}
                    height={140}
                    showValues={data.days.length <= 10}
                  />
                </Stack>
              </Stack>
            </Grid>
          </Stack>

          <Divider />

          {/* Mix */}
          <Stack gap={16}>
            <SectionLabel
              title="Mix"
              caption={`Model spend and token composition · Source: ${source}`}
            />
            <Grid columns={2} gap={32} align="start">
              <Stack gap={14}>
                <Stack gap={4}>
                  <H3>Cost by model</H3>
                  <Text tone="tertiary" size="small">
                    Share of {formatMoney(data.totalCost)} total spend
                  </Text>
                </Stack>
                <PieChart
                  data={data.models.map((m) => ({
                    label: `${shortModel(m.model)} · ${formatMoney(m.cost)}`,
                    value: Math.round(m.cost * 100) / 100,
                  }))}
                  donut
                  size={220}
                />
                <UsageBar
                  total={data.totalCost}
                  topLeftLabel="Spend mix"
                  topRightLabel={formatMoney(data.totalCost)}
                  segments={data.models.map((m, i) => ({
                    id: m.model,
                    value: m.cost,
                    color: USAGE_COLORS[i % USAGE_COLORS.length],
                  }))}
                />
                <Text tone="quaternary" size="small">
                  {data.models
                    .map(
                      (m, i) =>
                        `${USAGE_COLORS[i % USAGE_COLORS.length]}: ${shortModel(m.model)}`,
                    )
                    .join(" · ")}
                </Text>
              </Stack>

              <Stack gap={14}>
                <Stack gap={4}>
                  <H3>Token composition</H3>
                  <Text tone="tertiary" size="small">
                    Cache vs input vs output across{" "}
                    {formatTokens(data.totalTokens)} billed tokens
                  </Text>
                </Stack>
                {tokenMixSlices.length > 0 ? (
                  <PieChart data={tokenMixSlices} donut size={220} />
                ) : null}
                <Table
                  headers={["Type", "Tokens", "Share"]}
                  rows={[
                    [
                      "Cache read",
                      formatTokens(data.tokenMix.cacheRead),
                      `${pct(data.tokenMix.cacheRead, data.totalTokens).toFixed(1)}%`,
                    ],
                    [
                      "Input (w/o cache write)",
                      formatTokens(data.tokenMix.input),
                      `${pct(data.tokenMix.input, data.totalTokens).toFixed(1)}%`,
                    ],
                    ...(data.tokenMix.cacheWrite > 0
                      ? [
                          [
                            "Input (w/ cache write)",
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
                  striped
                />
              </Stack>
            </Grid>
          </Stack>

          <Divider />

          {/* Efficiency / kind */}
          <Stack gap={16}>
            <SectionLabel
              title="Efficiency"
              caption={`Kind mix and per-model cost intensity · Source: ${source}`}
            />
            <Grid columns="1fr 1.35fr" gap={28} align="start">
              <Stack gap={12}>
                <Stack gap={4}>
                  <H3>Kind mix</H3>
                  <Text tone="tertiary" size="small">
                    Cost share by event kind
                  </Text>
                </Stack>
                <UsageBar
                  total={data.totalCost}
                  topLeftLabel="Kind spend"
                  topRightLabel={formatMoney(data.totalCost)}
                  segments={data.kinds.map((k, i) => ({
                    id: k.kind,
                    value: k.cost,
                    color: USAGE_COLORS[i % USAGE_COLORS.length],
                  }))}
                />
                <Table
                  headers={["Kind", "Events", "Cost", "Share"]}
                  rows={data.kinds.map((k) => [
                    k.kind,
                    String(k.events),
                    formatMoney(k.cost),
                    `${k.share.toFixed(1)}%`,
                  ])}
                  columnAlign={["left", "right", "right", "right"]}
                  striped
                />
              </Stack>

              <Stack gap={12}>
                <Stack gap={4}>
                  <H3>Model efficiency</H3>
                  <Text tone="tertiary" size="small">
                    $/1M tokens uses Total Tokens from the export
                  </Text>
                </Stack>
                <Table
                  headers={[
                    "Model",
                    "Events",
                    "Cost",
                    "Tokens",
                    "Avg $/evt",
                    "$/1M tok",
                  ]}
                  rows={data.models.map((m) => [
                    shortModel(m.model),
                    String(m.events),
                    formatMoney(m.cost),
                    formatTokens(m.tokens),
                    formatMoney(m.avgCost, 3),
                    formatMoney(m.costPerM),
                  ])}
                  columnAlign={[
                    "left",
                    "right",
                    "right",
                    "right",
                    "right",
                    "right",
                  ]}
                  striped
                />
                {data.models.length > 0 ? (
                  <Text tone="secondary" size="small">
                    {(() => {
                      const best = [...data.models].sort(
                        (a, b) => a.costPerM - b.costPerM,
                      )[0];
                      const lead = data.models[0];
                      return `${shortModel(best.model)} is most token-efficient (${formatMoney(best.costPerM)} / 1M). ${shortModel(lead.model)} leads spend at ${formatMoney(lead.cost)} (${pct(lead.cost, data.totalCost).toFixed(0)}%).`;
                    })()}
                  </Text>
                ) : null}
              </Stack>
            </Grid>
          </Stack>

          {data.modelSeries.length > 1 && data.days.length > 1 ? (
            <>
              <Divider />
              <Stack gap={16}>
                <SectionLabel
                  title="Cost by model over time"
                  caption={`Stacked cost ($) by model and day · Source: ${source} · ${range}`}
                />
                <BarChart
                  categories={data.days.map((d) => d.label)}
                  series={data.modelSeries}
                  stacked
                  valuePrefix="$"
                  height={240}
                />
              </Stack>
            </>
          ) : null}

          {data.peakDay && data.peakHours.length > 0 ? (
            <>
              <Divider />
              <Card>
                <CardHeader
                  trailing={
                    <Pill size="sm">
                      {data.peakShare.toFixed(0)}% of spend
                    </Pill>
                  }
                >
                  Peak day — {data.peakDay.label}
                </CardHeader>
                <CardBody>
                  <Stack gap={18}>
                    <Row gap={20} wrap align="center">
                      <Stat
                        value={formatMoney(data.peakDay.cost)}
                        label="Day cost"
                        tone="warning"
                      />
                      <Stat
                        value={String(data.peakDay.events)}
                        label="Events"
                      />
                      <Stat
                        value={formatTokens(data.peakDay.tokens)}
                        label="Tokens"
                      />
                      <Spacer />
                      {data.peakHourSummary ? (
                        <Text
                          tone="secondary"
                          size="small"
                          style={{ maxWidth: 320, lineHeight: 1.45 }}
                        >
                          {data.peakHourSummary}
                        </Text>
                      ) : null}
                    </Row>
                    <Grid columns={2} gap={20}>
                      <Stack gap={8}>
                        <H3>Cost by hour (UTC)</H3>
                        <Text tone="tertiary" size="small">
                          Cost ($) · Hour · {data.peakDay.label} · {source}
                        </Text>
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
                          showValues={data.peakHours.length <= 12}
                        />
                      </Stack>
                      <Stack gap={8}>
                        <H3>Events by hour (UTC)</H3>
                        <Text tone="tertiary" size="small">
                          Event count · Hour · {data.peakDay.label} · {source}
                        </Text>
                        <BarChart
                          categories={data.peakHours.map((h) => h.hour)}
                          series={[
                            {
                              name: "Events",
                              data: data.peakHours.map((h) => h.events),
                            },
                          ]}
                          height={200}
                          showValues={data.peakHours.length <= 12}
                        />
                      </Stack>
                    </Grid>
                  </Stack>
                </CardBody>
              </Card>
            </>
          ) : null}

          <Divider />

          <Stack gap={16}>
            <SectionLabel
              title="Highest-cost events"
              caption={`Top ${data.topEvents.length} by Cost · Source: ${source} · ${range}`}
            />
            <Table
              headers={[
                "When (UTC)",
                "Model",
                "Kind",
                "Total tokens",
                "Output",
                "Cost",
              ]}
              rows={data.topEvents.map((r) => [
                eventWhen(r["Date"]),
                shortModel(r["Model"]),
                r["Kind"],
                formatTokens(parseNumber(r["Total Tokens"]) || 0),
                formatTokens(parseNumber(r["Output Tokens"]) || 0),
                formatMoney(parseNumber(r["Cost"]) || 0),
              ])}
              columnAlign={["left", "left", "left", "right", "right", "right"]}
              striped
            />
          </Stack>

          {data.days.length > 0 ? (
            <>
              <Divider />
              <Stack gap={16}>
                <SectionLabel
                  title="Daily breakdown"
                  caption={`Calendar-day rollup · Source: ${source} · ${range}`}
                />
                <Table
                  headers={["Date", "Events", "Cost", "Tokens", "Notes"]}
                  rows={data.days.map((d) => [
                    d.date,
                    String(d.events),
                    formatMoney(d.cost),
                    formatTokens(d.tokens),
                    d.note,
                  ])}
                  columnAlign={["left", "right", "right", "right", "left"]}
                  rowTone={data.days.map((d) =>
                    data.peakDay && d.date === data.peakDay.date
                      ? ("warning" as const)
                      : undefined,
                  )}
                  striped
                />
              </Stack>
            </>
          ) : null}

          <Text
            tone="quaternary"
            size="small"
            style={{
              borderTop: `1px solid ${theme.stroke.tertiary}`,
              paddingTop: 20,
              lineHeight: 1.5,
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
