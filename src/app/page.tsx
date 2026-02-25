"use client";

import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";

import annotationPlugin from "chartjs-plugin-annotation";


ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  annotationPlugin
);

// Custom plugin to shade the sleep window reliably (including Safari)
const sleepWindowPlugin = {
  id: "sleepWindow",
  beforeDraw(chart: any, _args: any, opts: any) {
    const bedtimeIndex = opts?.bedtimeIndex;
    if (typeof bedtimeIndex !== "number") return;

    const area = chart.chartArea;
    if (!area) return;

    // Try to anchor to an actual data point for maximum reliability
    const meta = chart.getDatasetMeta?.(0);
    const point = meta?.data?.[bedtimeIndex];

    let x = point?.x;

    // Fallback to scale methods
    if (!Number.isFinite(x)) {
      const xScale = chart.scales?.x;
      if (!xScale) return;
      x = typeof xScale.getPixelForTick === "function"
        ? xScale.getPixelForTick(bedtimeIndex)
        : xScale.getPixelForValue(bedtimeIndex);
    }

    if (!Number.isFinite(x)) return;

    const startX = Math.max(area.left, Math.min(x, area.right));
    if (startX >= area.right) return;

    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = opts?.color ?? "rgba(52, 120, 246, 0.18)";
    ctx.fillRect(startX, area.top, area.right - startX, area.bottom - area.top);

    // Add a subtle left border so the start is obvious
    ctx.strokeStyle = "rgba(52, 120, 246, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, area.top);
    ctx.lineTo(startX, area.bottom);
    ctx.stroke();

    ctx.restore();
  },
};

// Custom plugin to shade focus zones reliably (including Safari)
const focusZonesPlugin = {
  id: "focusZones",
  beforeDraw(chart: any, _args: any, opts: any) {
    const zones = opts?.zones;
    if (!Array.isArray(zones) || zones.length === 0) return;

    const area = chart.chartArea;
    if (!area) return;

    const meta = chart.getDatasetMeta?.(0);
    const xScale = chart.scales?.x;
    if (!xScale) return;

    const ctx = chart.ctx;
    ctx.save();

    const fill = opts?.color ?? "rgba(52, 199, 89, 0.18)";
    const stroke = opts?.borderColor ?? "rgba(52, 199, 89, 0.55)";

    for (const z of zones) {
      const startIndex = z?.startIndex;
      const endIndex = z?.endIndex;
      if (typeof startIndex !== "number" || typeof endIndex !== "number") continue;

      const startPoint = meta?.data?.[startIndex];
      const endPoint = meta?.data?.[endIndex];

      let x1 = startPoint?.x;
      let x2 = endPoint?.x;

      if (!Number.isFinite(x1)) {
        x1 = typeof xScale.getPixelForTick === "function"
          ? xScale.getPixelForTick(startIndex)
          : xScale.getPixelForValue(startIndex);
      }

      if (!Number.isFinite(x2)) {
        x2 = typeof xScale.getPixelForTick === "function"
          ? xScale.getPixelForTick(endIndex)
          : xScale.getPixelForValue(endIndex);
      }

      if (!Number.isFinite(x1) || !Number.isFinite(x2)) continue;

      const left = Math.max(area.left, Math.min(Math.min(x1, x2), area.right));
      const right = Math.max(area.left, Math.min(Math.max(x1, x2), area.right));
      if (right <= left) continue;

      ctx.fillStyle = fill;
      ctx.fillRect(left, area.top, right - left, area.bottom - area.top);

      // subtle borders
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(left, area.top);
      ctx.lineTo(left, area.bottom);
      ctx.moveTo(right, area.top);
      ctx.lineTo(right, area.bottom);
      ctx.stroke();
    }

    ctx.restore();
  },
};

// Register focus zone shading first, then sleep window shading
ChartJS.register(focusZonesPlugin);
ChartJS.register(sleepWindowPlugin);


type CoffeeKey =
  | "brewed"
  | "espresso"
  | "americano"
  | "latte"
  | "cappuccino"
  | "instant";

type Coffee = {
  id: number;
  key: CoffeeKey;
  time: string; // HH:mm
  shots: number;
  mg: number; // editable
};

const COFFEE_LABELS: Record<CoffeeKey, string> = {
  brewed: "Brewed coffee",
  espresso: "Espresso",
  americano: "Americano",
  latte: "Latte",
  cappuccino: "Cappuccino",
  instant: "Instant coffee",
};

function computeMg(key: CoffeeKey, shots: number) {
  if (key === "brewed") return 96;
  if (key === "instant") return 62;
  return shots * 63; // espresso-based
}

function assumptionText(key: CoffeeKey, shots: number) {
  if (key === "brewed") return "Assumption: 8 oz brewed coffee = 96 mg.";
  if (key === "instant") return "Assumption: 8 oz instant coffee = 62 mg.";
  if (key === "espresso") {
    return `Assumption: ${shots} shot${shots === 1 ? "" : "s"} × 63 mg = ${shots * 63} mg.`;
  }
  return `Assumption: ${COFFEE_LABELS[key]} uses espresso shots. ${shots} shot${shots === 1 ? "" : "s"} × 63 mg = ${shots * 63} mg.`;
}

function combineWithBaseDate(baseDate: Date, timeHHMM: string) {
  const [hh, mm] = timeHHMM.split(":").map(Number);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hh,
    mm,
    0,
    0
  );
}

function totalCaffeineAtTime(
  coffees: Coffee[],
  atTime: Date,
  halfLifeHours: number,
  logBaseDate: Date
) {

  let total = 0;
  const atMs = atTime.getTime();

  for (const c of coffees) {
    const doseTime = combineWithBaseDate(logBaseDate, c.time);
    const doseMs = doseTime.getTime();
    if (atMs <= doseMs) continue;

    const hoursSince = (atMs - doseMs) / (1000 * 60 * 60);
    total += c.mg * Math.pow(0.5, hoursSince / halfLifeHours);
  }

  return total;
}

function build24hSeriesFromStart(
  coffees: Coffee[],
  halfLifeHours: number,
  start: Date,
  logBaseDate: Date
) {
  const points: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = new Date(start.getTime() + i * 60 * 60 * 1000);
    points.push(totalCaffeineAtTime(coffees, t, halfLifeHours, logBaseDate));
  }
  return points;
}

function formatClockTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}


type CardProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

function Card({ title, subtitle, children, style }: CardProps) {
  return (
    <section
      style={{
        background: "rgba(255,255,255,0.9)",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 12 }}>
          {title && (
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2 }}>{title}</div>
          )}
          {subtitle && (
            <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 10px",
        borderRadius: 12,
        border: active ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(0,0,0,0.06)",
        background: active ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.7)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: -0.1,
      }}
    >
      {children}
    </button>
  );
}

const UI = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f7",
    color: "#111",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial",
  } as const,
  container: {
    maxWidth: 920,
    margin: "0 auto",
    padding: "28px 18px 48px",
  } as const,
  h1: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -0.6,
  } as const,
  sub: {
    marginTop: 8,
    fontSize: 13,
    color: "rgba(0,0,0,0.55)",
  } as const,
  row: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  } as const,
  input: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "rgba(255,255,255,0.9)",
    outline: "none",
    fontSize: 12,
  } as const,
  select: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "rgba(255,255,255,0.9)",
    outline: "none",
    fontSize: 12,
  } as const,
  primaryButton: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "#0a84ff",
    color: "white",
    fontWeight: 700,
    letterSpacing: -0.2,
    cursor: "pointer",
  } as const,
  textButton: {
    background: "none",
    border: "none",
    color: "rgba(0,0,0,0.55)",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
    fontWeight: 600,
  } as const,
  divider: {
    height: 1,
    background: "rgba(0,0,0,0.06)",
    margin: "12px 0",
  } as const,
};

function bedtimeOnOrAfter(baseDate: Date, bedtimeHHMM: string, afterTime: Date) {
  const [hh, mm] = bedtimeHHMM.split(":").map(Number);
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm, 0, 0);
  if (dt.getTime() < afterTime.getTime()) dt.setDate(dt.getDate() + 1);
  return dt;
}


export default function Page() {

  const [now, setNow] = useState(() => new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [bedtime, setBedtime] = useState("22:00");
  const [halfLifeHours, setHalfLifeHours] = useState(5);
  const [sensitivity, setSensitivity] = useState<"typical" | "slow">("typical");

  const [coffees, setCoffees] = useState<Coffee[]>([
    { id: 1, key: "brewed", time: "08:00", shots: 2, mg: 96 },
  ]);

  function addCoffee() {
    const key: CoffeeKey = "brewed";
    const shots = 2;
    setCoffees([
      ...coffees,
      { id: Date.now(), key, time: "12:00", shots, mg: computeMg(key, shots) },
    ]);
  }

  function updateCoffee(
    id: number,
    field: "key" | "time" | "shots" | "mg",
    value: string
  ) {
    setCoffees(
      coffees.map((c) => {
        if (c.id !== id) return c;

        if (field === "time") return { ...c, time: value };
        if (field === "mg") return { ...c, mg: Number(value) };

        if (field === "shots") {
          const shots = Math.max(1, Number(value));
          return { ...c, shots, mg: computeMg(c.key, shots) };
        }

        // field === "key"
        const key = value as CoffeeKey;
        const shots = c.shots || 2;
        return { ...c, key, mg: computeMg(key, shots) };
      })
    );
  }

  function removeCoffee(id: number) {
    setCoffees(coffees.filter((c) => c.id !== id));
  }

  const logBaseDate = useMemo(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const hasFutureTime = coffees.some((c) => {
      const [hh, mm] = c.time.split(":").map(Number);
      const tMinutes = hh * 60 + mm;
      return tMinutes > nowMinutes;
    });

  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (hasFutureTime) base.setDate(base.getDate() - 1); // treat all entries as yesterday
  return base;
}, [coffees]);

  const chartStart = useMemo(() => {
    if (coffees.length === 0) return new Date();

    const minMs = Math.min(
      ...coffees.map((c) => combineWithBaseDate(logBaseDate, c.time).getTime())
    );
    return new Date(minMs);
  }, [coffees, logBaseDate]);

  const series = useMemo(
    () => build24hSeriesFromStart(coffees, halfLifeHours, chartStart, logBaseDate),
    [coffees, halfLifeHours, chartStart, logBaseDate]
  );

  const seriesMax = useMemo(() => {
    return Math.max(0, ...series);
  }, [series]);

  const labels = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = new Date(chartStart.getTime() + i * 60 * 60 * 1000);
      out.push(t.toLocaleTimeString([], { hour: "numeric" }));
    }
    return out;
  }, [chartStart]);

  const bedtimeIndex = useMemo(() => {
    const bed = bedtimeOnOrAfter(logBaseDate, bedtime, chartStart);
    const diff = (bed.getTime() - chartStart.getTime()) / (60 * 60 * 1000);
    return Math.min(24, Math.max(0, Math.round(diff)));
  }, [bedtime, chartStart, logBaseDate]);

  const chartData = useMemo(() => {
    return {
      labels,
      datasets: [
        {
          label: "Caffeine (mg)",
          data: series.map((v) => Math.round(v)),
          tension: 0.25,
        },
      ],
    };
  }, [labels, series]);

  const focusZones = useMemo(() => {
    // Pick the best and second-best NON-OVERLAPPING 2-hour windows.
    // Windows are hourly and span 2 hours: [i, i+2). Two windows do not overlap iff |i - j| >= 2.
    // Average is approximated from hourly points using trapezoids:
    // area ≈ 0.5*s[i] + s[i+1] + 0.5*s[i+2], then divide by 2 hours.

    const makeZone = (startIdx: number, avg: number) => {
      const start = new Date(chartStart.getTime() + startIdx * 60 * 60 * 1000);
      const end = new Date(chartStart.getTime() + (startIdx + 2) * 60 * 60 * 1000);
      return { startIndex: startIdx, endIndex: startIdx + 2, avgMg: Math.round(avg), start, end };
    };

    if (series.length < 3) {
      const z = makeZone(0, 0);
      return { top1: z, top2: z };
    }

    const candidates: { startIdx: number; avg: number }[] = [];
    for (let i = 0; i <= 22; i++) {
      const s0 = series[i] ?? 0;
      const s1 = series[i + 1] ?? 0;
      const s2 = series[i + 2] ?? 0;
      const avg = (0.5 * s0 + s1 + 0.5 * s2) / 2;
      candidates.push({ startIdx: i, avg: Number.isFinite(avg) ? avg : -Infinity });
    }

    candidates.sort((a, b) => b.avg - a.avg);

    const top1Cand = candidates[0];
    const top1 = makeZone(top1Cand.startIdx, top1Cand.avg);

    const minGapHours = 4; // minimum separation between zone starts

    let top2Cand: { startIdx: number; avg: number } | undefined = undefined;
    for (const c of candidates) {
      if (Math.abs(c.startIdx - top1Cand.startIdx) >= minGapHours) {
        top2Cand = c;
        break;
      }
    }

    const top2 = top2Cand ? makeZone(top2Cand.startIdx, top2Cand.avg) : makeZone(22, 0);

    return { top1, top2 };
  }, [series, chartStart]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        annotation: {
          annotations: {
            bedtimeLine: {
              type: "line" as const,
              scaleID: "x" as const,
              value: bedtimeIndex,
              borderDash: [6, 6],
              borderWidth: 1,
              label: {
                display: true,
                content: "Bedtime",
                position: "start" as const,
              },
            },
          },
        },
        sleepWindow: {
          bedtimeIndex,
          color: "rgba(52, 120, 246, 0.18)",
        },
        focusZones: {
          zones: [
            {
              startIndex: focusZones.top1.startIndex,
              endIndex: focusZones.top1.endIndex,
            },
            {
              startIndex: focusZones.top2.startIndex,
              endIndex: focusZones.top2.endIndex,
            },
          ],
          color: "rgba(52, 199, 89, 0.12)",
          borderColor: "rgba(52, 199, 89, 0.45)",
        },
      },
    } as any;
  }, [bedtimeIndex, focusZones]);

  const below25Time = useMemo(() => {
    const idx = series.findIndex((v) => v < 25);
    if (idx === -1) return null;
    const t = new Date(chartStart.getTime() + idx * 60 * 60 * 1000);
    return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [series, chartStart]);

  const mgAtBedtime = useMemo(() => {
    const bed = bedtimeOnOrAfter(logBaseDate, bedtime, chartStart);
    const diff = (bed.getTime() - chartStart.getTime()) / (60 * 60 * 1000);
    const idx = Math.min(24, Math.max(0, Math.round(diff)));
    return Math.round(series[idx] ?? 0);
  }, [bedtime, series, chartStart, logBaseDate]);

  const guidance = useMemo(() => {
    const mg = mgAtBedtime;
    if (mg >= 150) return "More likely to affect sleep.";
    if (mg >= 75) return "Possible impact on sleep.";
    return "Less likely to affect sleep (sensitivity varies).";
  }, [mgAtBedtime]);

  return (
    <main style={UI.page}>
      <div style={UI.container}>
        <header
          style={{
            marginBottom: 20,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "rgba(0,0,0,0.45)",
            }}
          >
            Health
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: -1,
            }}
          >
            Caffeine Tracker
          </h1>

          <div
            style={{
              fontSize: 13,
              color: "rgba(0,0,0,0.55)",
              marginTop: 2,
            }}
          >
            Now {mounted ? now.toLocaleString("en-GB") : ""} · Chart starts{" "}
            {mounted ? chartStart.toLocaleString("en-GB") : ""}
          </div>
        </header>

        <style>{`
          .layoutGrid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
            align-items: stretch;
          }
          @media (min-width: 980px) {
            .layoutGrid {
              grid-template-columns: 1fr 1.2fr;
            }
          }
          .stack {
            display: flex;
            flex-direction: column;
            gap: 10px;
            height: 100%;
            min-height: 0;
          }
          .statsGrid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
          }
          @media (min-width: 980px) {
            .statsGrid {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }
        `}</style>

        <div className="layoutGrid">
          <div className="stack">
            <Card title="Setup" subtitle="Enter bedtime and adjust caffeine half-life.">
              <div style={UI.row}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>Bedtime</span>
                  <input
                    type="time"
                    value={bedtime}
                    onChange={(e) => setBedtime(e.target.value)}
                    style={UI.input}
                  />
                </label>

                <div style={{ minWidth: 240, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>Half-life</span>
                    <span style={{ fontSize: 11, color: "rgba(0,0,0,0.65)", fontWeight: 600 }}>{halfLifeHours}h</span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={7}
                    step={0.5}
                    value={halfLifeHours}
                    onChange={(e) => setHalfLifeHours(Number(e.target.value))}
                    style={{ display: "block", width: "100%", marginTop: 8 }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>Sensitivity</span>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: 6,
                      borderRadius: 14,
                      background: "rgba(0,0,0,0.04)",
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <PillButton
                      active={sensitivity === "typical"}
                      onClick={() => {
                        setSensitivity("typical");
                        setHalfLifeHours(5);
                      }}
                    >
                      Typical
                    </PillButton>
                    <PillButton
                      active={sensitivity === "slow"}
                      onClick={() => {
                        setSensitivity("slow");
                        setHalfLifeHours(6.5);
                      }}
                    >
                      Slow
                    </PillButton>
                  </div>
                </div>
              </div>
            </Card>

            <Card
              title="Coffees"
              subtitle="Log each drink. Times are interpreted relative to your current session."
              style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    paddingRight: 2,
                  }}
                >
                  {coffees.map((coffee) => (
                    <div
                      key={coffee.id}
                      style={{
                        padding: 6,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.06)",
                        background: "rgba(255,255,255,0.7)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                          value={coffee.key}
                          onChange={(e) => updateCoffee(coffee.id, "key", e.target.value)}
                          style={{ ...UI.select, padding: "6px 9px", fontSize: 12, borderRadius: 10 }}
                        >
                          <option value="brewed">Brewed coffee</option>
                          <option value="espresso">Espresso</option>
                          <option value="americano">Americano</option>
                          <option value="latte">Latte</option>
                          <option value="cappuccino">Cappuccino</option>
                          <option value="instant">Instant coffee</option>
                        </select>

                        <input
                          type="time"
                          value={coffee.time}
                          onChange={(e) => updateCoffee(coffee.id, "time", e.target.value)}
                          style={{ ...UI.input, padding: "6px 9px", fontSize: 12, borderRadius: 10 }}
                        />

                        {coffee.key !== "brewed" && coffee.key !== "instant" && (
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>Shots</span>
                            <input
                              type="number"
                              min={1}
                              max={6}
                              value={coffee.shots}
                              onChange={(e) => updateCoffee(coffee.id, "shots", e.target.value)}
                              style={{ ...UI.input, width: 76, padding: "6px 9px", fontSize: 12, borderRadius: 10 }}
                            />
                          </label>
                        )}

                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>Caffeine</span>
                          <input
                            type="number"
                            value={coffee.mg}
                            onChange={(e) => updateCoffee(coffee.id, "mg", e.target.value)}
                            style={{ ...UI.input, width: 86, padding: "6px 9px", fontSize: 12, borderRadius: 10 }}
                          />
                          <span style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 600 }}>mg</span>
                        </label>

                        <button onClick={() => removeCoffee(coffee.id)} style={{ ...UI.textButton, fontSize: 11 }}>
                          Remove
                        </button>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
                        {assumptionText(coffee.key, coffee.shots)}
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <button onClick={addCoffee} style={{ ...UI.primaryButton, width: "100%" }}>
                    Add coffee
                  </button>
                </div>
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card title="Caffeine (next 24 hours)" subtitle="Shaded region indicates your sleep window.">
              <div style={{ height: 260 }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            </Card>

            <div className="statsGrid">
              <Card title="Focus Zone #1" subtitle="Highest 2-hour window." style={{ padding: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.6 }}>{focusZones.top1.avgMg} mg</div>
                <div style={{ marginTop: 6, fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
                  {formatClockTime(focusZones.top1.start)} to {formatClockTime(focusZones.top1.end)}
                </div>
              </Card>

              <Card title="Focus Zone #2" subtitle="2nd highest 2-hour window." style={{ padding: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.6 }}>{focusZones.top2.avgMg} mg</div>
                <div style={{ marginTop: 6, fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
                  {formatClockTime(focusZones.top2.start)} to {formatClockTime(focusZones.top2.end)}
                </div>
              </Card>

              <Card title="At bedtime" subtitle="Estimated caffeine remaining." style={{ padding: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.6 }}>{mgAtBedtime} mg</div>
              </Card>
            </div>

            <Card title="Guidance" subtitle="Educational estimate. Sensitivity varies.">
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{guidance}</div>
              {below25Time && (
                <div style={{ marginTop: 10, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                  Estimated caffeine drops below 25 mg around {below25Time}.
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
