interface Props {
  x: number[];
  y: (number | null)[];
  color: string;
  height?: number;
  fill?: boolean;
  /** Optional elevation series drawn faintly behind the main line for context. */
  backdrop?: (number | null)[];
  unit?: string;
}

const W = 800;
const PAD = 6;

function extent(values: (number | null)[]): [number, number] {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return [0, 1];
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  return [lo, hi];
}

function buildPath(
  x: number[],
  y: (number | null)[],
  h: number,
  yLo: number,
  yHi: number,
  xLo: number,
  xHi: number,
): string {
  const sx = (v: number) => PAD + ((v - xLo) / (xHi - xLo || 1)) * (W - 2 * PAD);
  const sy = (v: number) => PAD + (1 - (v - yLo) / (yHi - yLo || 1)) * (h - 2 * PAD);
  let d = "";
  let pen = false;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (v == null) {
      pen = false;
      continue;
    }
    const px = sx(x[i] ?? i);
    const py = sy(v);
    d += `${pen ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

export default function LineChart({
  x,
  y,
  color,
  height = 130,
  fill = false,
  backdrop,
  unit,
}: Props) {
  const [xLo, xHi] = [x[0] ?? 0, x[x.length - 1] ?? 1];
  const [yLo, yHi] = extent(y);
  const line = buildPath(x, y, height, yLo, yHi, xLo, xHi);

  const sx = (v: number) => PAD + ((v - xLo) / (xHi - xLo || 1)) * (W - 2 * PAD);

  // area under the line
  let area = "";
  if (fill && line) {
    const first = y.findIndex((v) => v != null);
    let lastIdx = -1;
    for (let i = y.length - 1; i >= 0; i--) {
      if (y[i] != null) {
        lastIdx = i;
        break;
      }
    }
    if (first >= 0 && lastIdx >= 0) {
      area = `${line} L${sx(x[lastIdx] ?? lastIdx).toFixed(1)} ${(height - PAD).toFixed(
        1,
      )} L${sx(x[first] ?? first).toFixed(1)} ${(height - PAD).toFixed(1)} Z`;
    }
  }

  let backPath = "";
  if (backdrop) {
    const [bLo, bHi] = extent(backdrop);
    backPath = buildPath(x, backdrop, height, bLo, bHi, xLo, xHi);
  }

  const gid = `grad-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={unit}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {backPath && (
          <path d={backPath} fill="none" stroke="rgba(26,26,24,0.12)" strokeWidth={1.5} />
        )}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}
