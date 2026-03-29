import { PlotlyData } from "@/lib/api";

export interface HistBins {
  labels: string[];
  baseCounts: number[];
  candCounts: number[];
}

/** Decode Plotly binary-encoded array (base64 bdata with dtype) into number[] */
function decodePlotlyBinary(obj: unknown): number[] | null {
  if (Array.isArray(obj)) return obj as number[];
  if (typeof obj === "object" && obj !== null && "bdata" in obj && "dtype" in obj) {
    const { bdata, dtype } = obj as { bdata: string; dtype: string };
    try {
      const binary = atob(bdata);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (dtype === "f8") {
        return Array.from(new Float64Array(bytes.buffer));
      } else if (dtype === "f4") {
        return Array.from(new Float32Array(bytes.buffer));
      } else if (dtype === "i4") {
        return Array.from(new Int32Array(bytes.buffer));
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Bin an array of raw values into a histogram with numBins bins */
function binValues(values: number[], numBins: number, rangeMin?: number, rangeMax?: number): { edges: number[]; counts: number[] } {
  const min = rangeMin ?? Math.min(...values);
  const max = rangeMax ?? Math.max(...values);
  const binWidth = (max - min) / numBins;

  const counts = new Array(numBins).fill(0);
  const edges = new Array(numBins).fill(0).map((_, i) => min + (i + 0.5) * binWidth);

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= numBins) idx = numBins - 1;
    counts[idx]++;
  }

  // Normalize to density
  const total = values.length;
  const density = counts.map(c => c / (total * binWidth));

  return { edges, counts: density };
}

/** Convert Plotly histogram data (with raw x values) to binned Chart.js format */
export function plotlyToHistBins(plotly: PlotlyData, numBins = 60): HistBins | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces = plotly.data as any[];
  if (!traces || traces.length < 2) return null;

  const baseX = decodePlotlyBinary(traces[0].x);
  const candX = decodePlotlyBinary(traces[1].x);

  if (!baseX || !candX || baseX.length === 0 || candX.length === 0) return null;

  // Use common range for both histograms
  const allValues = [...baseX, ...candX];
  const rangeMin = Math.min(...allValues);
  const rangeMax = Math.max(...allValues);

  // Multiply by 100 to convert fraction to percentage (if values are small fractions)
  const scale = rangeMax <= 2 ? 100 : 1; // if max < 2, values are likely fractions

  const scaledBase = baseX.map(v => v * scale);
  const scaledCand = candX.map(v => v * scale);
  const sMin = rangeMin * scale;
  const sMax = rangeMax * scale;

  const baseBins = binValues(scaledBase, numBins, sMin, sMax);
  const candBins = binValues(scaledCand, numBins, sMin, sMax);

  const labels = baseBins.edges.map(v => `${v.toFixed(0)}%`);

  return { labels, baseCounts: baseBins.counts, candCounts: candBins.counts };
}

/** Multi-pass neighbor averaging for smooth histogram overlays */
export function smooth(arr: number[], passes = 3): number[] {
  let prev = [...arr];
  for (let p = 0; p < passes; p++) {
    const next = [...prev];
    for (let i = 1; i < prev.length - 1; i++) {
      next[i] = prev[i - 1] * 0.2 + prev[i] * 0.6 + prev[i + 1] * 0.2;
    }
    prev = next;
  }
  return prev;
}
