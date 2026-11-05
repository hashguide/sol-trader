"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, LineSeries, LineStyle, createChart, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";

export interface ChartPayload {
  pairId: string;
  source: string;
  warning: string | null;
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  emaFast: { time: number; value: number }[];
  emaSlow: { time: number; value: number }[];
  bbUpper: { time: number; value: number }[];
  bbLower: { time: number; value: number }[];
  markers: { time: number; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text: string }[];
  stops: { stop: number; takeProfit: number; entry: number }[];
}

export function PriceChart({ data }: { data: ChartPayload }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || data.candles.length === 0) return;
    const chart = createChart(node, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#93a4b5", fontFamily: "IBM Plex Mono, ui-monospace, monospace" },
      grid: { vertLines: { color: "#24303a" }, horzLines: { color: "#24303a" } },
      rightPriceScale: { borderColor: "#2a3642" },
      timeScale: { borderColor: "#2a3642", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#e0b15a", labelBackgroundColor: "#e0b15a" }, horzLine: { color: "#e0b15a", labelBackgroundColor: "#e0b15a" } },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#3ecf8e",
      downColor: "#ff6b6b",
      borderVisible: false,
      wickUpColor: "#3ecf8e",
      wickDownColor: "#ff6b6b",
    });
    const asTime = (time: number) => time as UTCTimestamp;
    candles.setData(data.candles.map((bar) => ({ time: asTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
    const line = (color: string, width: 1 | 2 = 1) => chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
    line("#e0b15a").setData(data.emaFast.map((point) => ({ time: asTime(point.time), value: point.value })));
    line("#7f93a6").setData(data.emaSlow.map((point) => ({ time: asTime(point.time), value: point.value })));
    line("#3ecf8e").setData(data.bbUpper.map((point) => ({ time: asTime(point.time), value: point.value })));
    line("#ff6b6b").setData(data.bbLower.map((point) => ({ time: asTime(point.time), value: point.value })));
    const times = data.candles.map((bar) => bar.time);
    const markers = data.markers
      .map((marker) => {
        let best = times[0] ?? marker.time;
        let dist = Infinity;
        for (const time of times) {
          const gap = Math.abs(time - marker.time);
          if (gap < dist) {
            dist = gap;
            best = time;
          }
        }
        return dist <= 3600 ? { ...marker, time: asTime(best) } : null;
      })
      .filter((marker) => marker != null)
      .sort((a, b) => a.time - b.time);
    createSeriesMarkers(candles, markers);
    for (const stop of data.stops) {
      candles.createPriceLine({ price: stop.stop, color: "#ff6b6b", lineStyle: LineStyle.Dashed, title: "stop", lineWidth: 1 });
      candles.createPriceLine({ price: stop.takeProfit, color: "#3ecf8e", lineStyle: LineStyle.Dashed, title: "target", lineWidth: 1 });
      candles.createPriceLine({ price: stop.entry, color: "#e0b15a", lineStyle: LineStyle.Dotted, title: "entry", lineWidth: 1 });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data]);

  if (data.candles.length === 0) {
    return <p className="p-6 text-sm text-fog">No closed candles are stored for this pair yet.</p>;
  }
  return <div ref={ref} className="h-[440px] w-full" />;
}
