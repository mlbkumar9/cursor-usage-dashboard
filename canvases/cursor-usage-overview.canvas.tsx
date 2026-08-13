import {
  BarChart,
  Button,
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  LineChart,
  Select,
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

type DayAgg = {
  date: string;
  label: string;
  events: number;
  cost: number;
  tokens: number;
};

type TokenMix = {
  cacheWrite: number;
  input: number;
  cacheRead: number;
  output: number;
};

type ParetoPoint = {
  label: string;
  n: number;
  share: number;
};

type TopEvent = {
  when: string;
  model: string;
  kind: string;
  tokens: number;
  cost: number;
  cumShare: number;
};

type HourPair = {
  hour: string;
  peak: number;
  typical: number;
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
  freshTokens: number;
  costPerMAll: number;
  costPerMFresh: number;
  peakDay: DayAgg | null;
  peakShare: number;
  typicalCost: number;
  typicalEvents: number;
  typicalTokens: number;
  peakCostIndex: number;
  peakEventIndex: number;
  peakTokenIndex: number;
  halfSpendLabel: string;
  n80: number;
  n80Share: number;
  hero: string;
  days: DayAgg[];
  burn: number[];
  models: ModelAgg[];
  tokenMix: TokenMix;
  pareto: ParetoPoint[];
  topEvents: TopEvent[];
  hourClock: { hour: string; cost: number }[];
  peakVsTypicalHours: HourPair[];
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  const clock = new Map<number, number>();
  const dayHourCost = new Map<string, Map<number, number>>();
  const eventCosts: { row: CsvRow; cost: number; tokens: number }[] = [];

  for (const row of billed) {
    const cost = numOr0(row["Cost"]);
    const tokens = numOr0(row["Total Tokens"]);
    const model = row["Model"] || "(unknown)";
    const dt = new Date(row["Date"]);
    if (!Number.isNaN(dt.getTime())) eventDates.push(dt);

    totalCost += cost;
    totalTokens += tokens;
    tokenMix.cacheWrite += numOr0(row["Input (w/ Cache Write)"]);
    tokenMix.input += numOr0(row["Input (w/o Cache Write)"]);
    tokenMix.cacheRead += numOr0(row["Cache Read"]);
    tokenMix.output += numOr0(row["Output Tokens"]);
    eventCosts.push({ row, cost, tokens });

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

    if (!Number.isNaN(dt.getTime())) {
      const hour = dt.getUTCHours();
      clock.set(hour, (clock.get(hour) ?? 0) + cost);
      let dh = dayHourCost.get(dateKey);
      if (!dh) {
        dh = new Map();
        dayHourCost.set(dateKey, dh);
      }
      dh.set(hour, (dh.get(hour) ?? 0) + cost);
    }
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const models = [...modelMap.values()]
    .map((m) => ({
      ...m,
      avgCost: m.events > 0 ? m.cost / m.events : 0,
      costPerM: m.tokens > 0 ? (m.cost / m.tokens) * 1_000_000 : 0,
    }))
    .sort((a, b) => a.costPerM - b.costPerM);

  const peakDay = days.reduce<DayAgg | null>(
    (best, d) => (!best || d.cost > best.cost ? d : best),
    null,
  );
  const peakShare = peakDay && totalCost > 0 ? pct(peakDay.cost, totalCost) : 0;
  const cacheShare = pct(tokenMix.cacheRead, totalTokens);
  const avgCost = billed.length > 0 ? totalCost / billed.length : 0;
  const freshTokens = tokenMix.input + tokenMix.cacheWrite + tokenMix.output;
  const costPerMAll =
    totalTokens > 0 ? (totalCost / totalTokens) * 1_000_000 : 0;
  const costPerMFresh =
    freshTokens > 0 ? (totalCost / freshTokens) * 1_000_000 : 0;

  const otherDays = days.filter((d) => !peakDay || d.date !== peakDay.date);
  const typicalCost = median(otherDays.map((d) => d.cost));
  const typicalEvents = median(otherDays.map((d) => d.events));
  const typicalTokens = median(otherDays.map((d) => d.tokens));
  const peakCostIndex =
    typicalCost > 0 && peakDay ? peakDay.cost / typicalCost : 0;
  const peakEventIndex =
    typicalEvents > 0 && peakDay ? peakDay.events / typicalEvents : 0;
  const peakTokenIndex =
    typicalTokens > 0 && peakDay ? peakDay.tokens / typicalTokens : 0;

  let running = 0;
  const burn = days.map((d) => {
    running += d.cost;
    return round2(running);
  });
  let halfSpendLabel = "";
  running = 0;
  for (const d of days) {
    running += d.cost;
    if (totalCost > 0 && running >= totalCost * 0.5) {
      halfSpendLabel = d.label;
      break;
    }
  }

  const sortedEvents = [...eventCosts].sort((a, b) => b.cost - a.cost);
  let cum = 0;
  let n80 = sortedEvents.length;
  let n80Share = 100;
  for (let i = 0; i < sortedEvents.length; i++) {
    cum += sortedEvents[i].cost;
    if (totalCost > 0 && cum >= totalCost * 0.8) {
      n80 = i + 1;
      n80Share = pct(cum, totalCost);
      break;
    }
  }

  const cutoffs = [1, 5, 8, 10, 20].filter((n) => n < sortedEvents.length);
  if (sortedEvents.length > 0 && !cutoffs.includes(sortedEvents.length)) {
    cutoffs.push(sortedEvents.length);
  }
  const pareto: ParetoPoint[] = cutoffs.map((n) => {
    const share = pct(
      sortedEvents.slice(0, n).reduce((s, e) => s + e.cost, 0),
      totalCost,
    );
    return {
      label: n === sortedEvents.length ? "All events" : `Top ${n}`,
      n,
      share: round2(share),
    };
  });

  cum = 0;
  const topEvents: TopEvent[] = sortedEvents.slice(0, 8).map((e) => {
    cum += e.cost;
    return {
      when: eventWhen(e.row["Date"]),
      model: shortModel(e.row["Model"]),
      kind: e.row["Kind"],
      tokens: e.tokens,
      cost: e.cost,
      cumShare: round2(pct(cum, totalCost)),
    };
  });

  const hourClock = [...clock.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, cost]) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      cost: round2(cost),
    }));

  const peakVsTypicalHours: HourPair[] = [];
  if (peakDay && otherDays.length > 0) {
    const hours = new Set<number>();
    for (const [h, c] of clock) {
      if (c > 0) hours.add(h);
    }
    for (const h of [...hours].sort((a, b) => a - b)) {
      const peak = dayHourCost.get(peakDay.date)?.get(h) ?? 0;
      const typical = median(
        otherDays.map((d) => dayHourCost.get(d.date)?.get(h) ?? 0),
      );
      if (peak > 0 || typical > 0) {
        peakVsTypicalHours.push({
          hour: `${String(h).padStart(2, "0")}:00`,
          peak: round2(peak),
          typical: round2(typical),
        });
      }
    }
  }

  const notes: string[] = [];
  if (errored > 0) {
    notes.push(
      `${errored} event${errored === 1 ? "" : "s"} Kind "Errored, No Charge" excluded from billed totals`,
    );
  }
  if (tokenMix.cacheWrite === 0) {
    notes.push("No cache-write input in this export");
  }

  const n80Pct = billed.length > 0 ? pct(n80, billed.length) : 0;
  const heroParts: string[] = [];
  if (peakDay && peakCostIndex >= 1.4) {
    heroParts.push(
      `${peakDay.label} was ${peakCostIndex.toFixed(1)}× a typical active day (${peakShare.toFixed(0)}% of the bill)`,
    );
  } else if (halfSpendLabel) {
    heroParts.push(`half the spend had landed by ${halfSpendLabel}`);
  }
  if (n80 > 0 && n80 < billed.length) {
    heroParts.push(
      `${n80} of ${billed.length} events (${n80Pct.toFixed(0)}%) drove ${n80Share.toFixed(0)}% of cost`,
    );
  }
  if (cacheShare >= 50) {
    heroParts.push(`cache reads are ${cacheShare.toFixed(0)}% of tokens`);
  }
  const hero =
    heroParts.length > 0
      ? `${heroParts[0].charAt(0).toUpperCase()}${heroParts[0].slice(1)}${heroParts.length > 1 ? `. ${heroParts.slice(1).join(". ")}` : ""}.`
      : `This export billed ${formatMoney(totalCost)} across ${billed.length} events.`;

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
      freshTokens,
      costPerMAll,
      costPerMFresh,
      peakDay,
      peakShare,
      typicalCost,
      typicalEvents,
      typicalTokens,
      peakCostIndex,
      peakEventIndex,
      peakTokenIndex,
      halfSpendLabel,
      n80,
      n80Share,
      hero,
      days,
      burn,
      models,
      tokenMix,
      pareto,
      topEvents,
      hourClock,
      peakVsTypicalHours,
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
  const hairline = `1px solid ${theme.stroke.tertiary}`;
  const leanModel = data?.models[0];

  const cacheSegments = data
    ? [
        { id: "cache", value: data.tokenMix.cacheRead, color: "blue" as const },
        { id: "input", value: data.tokenMix.input, color: "gray" as const },
        ...(data.tokenMix.cacheWrite > 0
          ? [
              {
                id: "write",
                value: data.tokenMix.cacheWrite,
                color: "green" as const,
              },
            ]
          : []),
        {
          id: "output",
          value: data.tokenMix.output,
          color: "orange" as const,
        },
      ].filter((s) => s.value > 0)
    : [];

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
          <Text tone="secondary" style={{ maxWidth: 520, lineHeight: 1.55 }}>
            {data && data.billedEvents > 0
              ? data.hero
              : "What this export spent, and where."}
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

          <Grid columns={3} gap={32}>
            <Stat value={formatMoney(data.totalCost)} label="Total cost" />
            <Stat
              value={
                data.peakDay && data.peakCostIndex > 0
                  ? `${data.peakCostIndex.toFixed(1)}×`
                  : "—"
              }
              label={
                data.peakDay
                  ? `${data.peakDay.label} vs typical day`
                  : "Peak vs typical"
              }
            />
            <Stat
              value={`${data.n80}`}
              label={`${data.n80Share.toFixed(0)}% of spend`}
            />
          </Grid>
          <Text
            tone="tertiary"
            size="small"
            style={{ marginTop: 20, maxWidth: 640, lineHeight: 1.55 }}
          >
            {data.n80} events drove {data.n80Share.toFixed(0)}% of cost
            {data.halfSpendLabel
              ? ` · half the bill had landed by ${data.halfSpendLabel}`
              : ""}
            {` · cache reads ${data.cacheShare.toFixed(0)}% of tokens`}
            {` · ${formatMoney(data.costPerMFresh)} / 1M non-cache tokens vs ${formatMoney(data.costPerMAll)} / 1M all tokens`}.
          </Text>

          {data.days.length > 0 && data.burn.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="01"
                  title="Burn curve"
                  caption={`Cumulative billed cost ($). ${data.halfSpendLabel ? `Half the month's spend landed on ${data.halfSpendLabel}.` : ""} Source: ${source} · ${range}.`}
                />
                <LineChart
                  categories={data.days.map((d) => d.label)}
                  series={[
                    {
                      name: "Cumulative cost ($)",
                      data: data.burn,
                      tone: "info",
                    },
                  ]}
                  valuePrefix="$"
                  height={240}
                  fill
                  showValues={data.days.length <= 8}
                  referenceLines={
                    data.totalCost > 0
                      ? [
                          {
                            value: data.totalCost / 2,
                            label: "Half",
                            tone: "neutral",
                          },
                        ]
                      : undefined
                  }
                />
              </Stack>
            </>
          ) : null}

          {data.pareto.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="02"
                  title="Spend concentration"
                  caption={`${data.n80} events = ${data.n80Share.toFixed(0)}% of spend. Cumulative share of billed cost (%). Source: ${source} · ${range}.`}
                />
                <BarChart
                  categories={data.pareto.map((p) => p.label)}
                  series={[
                    {
                      name: "Cumulative share of cost (%)",
                      data: data.pareto.map((p) => p.share),
                      tone: "info",
                    },
                  ]}
                  horizontal
                  valueSuffix="%"
                  height={Math.min(220, 56 + data.pareto.length * 36)}
                  showValues
                  referenceLines={[
                    { value: 80, label: "80%", tone: "warning" },
                  ]}
                />
                {data.topEvents.length > 0 ? (
                  <Table
                    framed={false}
                    striped={false}
                    headers={["When", "Model", "Cost", "Cum. %"]}
                    rows={data.topEvents.map((e) => [
                      e.when,
                      e.model,
                      formatMoney(e.cost),
                      `${e.cumShare.toFixed(0)}%`,
                    ])}
                    columnAlign={["left", "left", "right", "right"]}
                  />
                ) : null}
              </Stack>
            </>
          ) : null}

          {cacheSegments.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="03"
                  title="Cache leverage"
                  caption={`Cache read vs fresh input vs output. Apparent ${formatMoney(data.costPerMAll)} / 1M tokens; ${formatMoney(data.costPerMFresh)} / 1M if cache reads are ignored. Source: ${source} · ${range}.`}
                />
                <UsageBar
                  total={Math.max(data.totalTokens, 1)}
                  topLeftLabel={`${data.cacheShare.toFixed(0)}% cache read`}
                  topRightLabel={`${formatTokens(data.totalTokens)} tokens`}
                  segments={cacheSegments}
                />
                <Grid columns={2} gap={24}>
                  <Stat
                    value={formatMoney(data.costPerMAll)}
                    label="$ / 1M all tokens"
                  />
                  <Stat
                    value={formatMoney(data.costPerMFresh)}
                    label="$ / 1M non-cache tokens"
                  />
                </Grid>
                <BarChart
                  categories={["All tokens", "Non-cache only"]}
                  series={[
                    {
                      name: "Cost per 1M tokens ($)",
                      data: [
                        round2(data.costPerMAll),
                        round2(data.costPerMFresh),
                      ],
                      tone: "neutral",
                    },
                  ]}
                  horizontal
                  valuePrefix="$"
                  height={120}
                  showValues
                />
                <Text tone="tertiary" size="small" style={{ lineHeight: 1.5 }}>
                  Cache read {formatTokens(data.tokenMix.cacheRead)} · fresh
                  input {formatTokens(data.tokenMix.input)}
                  {data.tokenMix.cacheWrite > 0
                    ? ` · cache write ${formatTokens(data.tokenMix.cacheWrite)}`
                    : ""}{" "}
                  · output {formatTokens(data.tokenMix.output)}.
                </Text>
              </Stack>
            </>
          ) : null}

          {data.peakDay && data.peakCostIndex > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="04"
                  title={`Peak anatomy · ${data.peakDay.label}`}
                  caption={`${data.peakDay.label} vs the median of other active days. Typical day ${formatMoney(data.typicalCost)}, ${Math.round(data.typicalEvents)} events, ${formatTokens(data.typicalTokens)} tokens. Source: ${source}.`}
                />
                <BarChart
                  categories={["Cost", "Events", "Tokens"]}
                  series={[
                    {
                      name: "Typical day",
                      data: [100, 100, 100],
                      tone: "neutral",
                    },
                    {
                      name: data.peakDay.label,
                      data: [
                        round2(data.peakCostIndex * 100),
                        round2(data.peakEventIndex * 100),
                        round2(data.peakTokenIndex * 100),
                      ],
                      tone: "warning",
                    },
                  ]}
                  valueSuffix="%"
                  height={200}
                  showValues
                />
                {data.peakVsTypicalHours.length > 0 ? (
                  <LineChart
                    categories={data.peakVsTypicalHours.map((h) => h.hour)}
                    series={[
                      {
                        name: `${data.peakDay.label} ($)`,
                        data: data.peakVsTypicalHours.map((h) => h.peak),
                        tone: "warning",
                      },
                      {
                        name: "Typical day ($)",
                        data: data.peakVsTypicalHours.map((h) => h.typical),
                        tone: "neutral",
                      },
                    ]}
                    valuePrefix="$"
                    height={200}
                    fill
                  />
                ) : null}
              </Stack>
            </>
          ) : null}

          {data.hourClock.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="05"
                  title="Usage clock"
                  caption={`Billed cost ($) by hour of day, all days combined. UTC. Source: ${source} · ${range}.`}
                />
                <BarChart
                  categories={data.hourClock.map((h) => h.hour)}
                  series={[
                    {
                      name: "Cost ($)",
                      data: data.hourClock.map((h) => h.cost),
                      tone: "info",
                    },
                  ]}
                  valuePrefix="$"
                  height={200}
                  showValues={data.hourClock.length <= 8}
                />
              </Stack>
            </>
          ) : null}

          {data.models.length > 0 ? (
            <>
              <Divider style={{ marginTop: 56, marginBottom: 48 }} />
              <Stack gap={24}>
                <Band
                  kicker="06"
                  title="Model efficiency"
                  caption={`Cost per 1 million tokens — the efficiency frontier. Lower is leaner. Source: ${source} · ${range}.`}
                />
                <BarChart
                  categories={data.models.map((m) => shortModel(m.model))}
                  series={[
                    {
                      name: "Cost per 1M tokens ($)",
                      data: data.models.map((m) => round2(m.costPerM)),
                      tone: "neutral",
                    },
                  ]}
                  horizontal
                  valuePrefix="$"
                  height={Math.min(200, 56 + data.models.length * 36)}
                  showValues
                />
                <Table
                  framed={false}
                  striped={false}
                  headers={["Model", "Events", "Cost", "Tokens", "$/1M"]}
                  rows={data.models.map((m) => [
                    shortModel(m.model),
                    String(m.events),
                    formatMoney(m.cost),
                    formatTokens(m.tokens),
                    formatMoney(m.costPerM),
                  ])}
                  columnAlign={["left", "right", "right", "right", "right"]}
                />
                {leanModel ? (
                  <Text tone="tertiary" size="small" style={{ lineHeight: 1.5 }}>
                    {shortModel(leanModel.model)} is the most token-efficient at{" "}
                    {formatMoney(leanModel.costPerM)} / 1M.
                  </Text>
                ) : null}
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

