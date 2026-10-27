export class GroupingError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "GroupingError";
    this.code = code;
  }
}

export const PT_MONTHS: Record<number, string> = {
  1: "jan",
  2: "fev",
  3: "mar",
  4: "abr",
  5: "mai",
  6: "jun",
  7: "jul",
  8: "ago",
  9: "set",
  10: "out",
  11: "nov",
  12: "dez",
};

export function parseGroupDate(
  rawVal: unknown,
  blockLabel = "Gráfico",
  colName = "Data",
): {
  year: number;
  month: number;
  day: number;
  dateObj: Date;
} | null {
  if (rawVal === null || rawVal === undefined || rawVal === "") {
    return null;
  }
  if (rawVal instanceof Date) {
    if (isNaN(rawVal.getTime())) {
      throw new GroupingError(
        `Gráfico "${blockLabel}": a coluna "${colName}" não é uma data (valor "${rawVal}"). Escolha outra coluna ou remova o agrupamento.`,
        "x_not_a_date",
      );
    }
    return {
      year: rawVal.getFullYear(),
      month: rawVal.getMonth() + 1,
      day: rawVal.getDate(),
      dateObj: new Date(rawVal.getFullYear(), rawVal.getMonth(), rawVal.getDate()),
    };
  }

  if (typeof rawVal === "string") {
    const s = rawVal.trim();
    // Match YYYY-MM-DD
    const isoMatch = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
    );
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10);
      const day = parseInt(isoMatch[3], 10);
      return {
        year,
        month,
        day,
        dateObj: new Date(year, month - 1, day),
      };
    }
    // Match DD/MM/YYYY
    const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const day = parseInt(brMatch[1], 10);
      const month = parseInt(brMatch[2], 10);
      const year = parseInt(brMatch[3], 10);
      return {
        year,
        month,
        day,
        dateObj: new Date(year, month - 1, day),
      };
    }
  }

  throw new GroupingError(
    `Gráfico "${blockLabel}": a coluna "${colName}" não é uma data (valor "${rawVal}"). Escolha outra coluna ou remova o agrupamento.`,
    "x_not_a_date",
  );
}

export function parseNumericValue(
  value: unknown,
  seriesName?: string,
  _blockLabel = "Bloco",
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    const msg = seriesName
      ? `A série "${seriesName}" não pode conter valor booleano.`
      : "Valor booleano não pode compor uma série numérica.";
    throw new GroupingError(msg, "series_not_numeric");
  }
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num) || !isFinite(num)) {
    const msg = seriesName
      ? `A série "${seriesName}" precisa ser numérica; a coluna tem texto (ex.: "${value}").`
      : "A coluna selecionada deve ser numérica.";
    throw new GroupingError(msg, "series_not_numeric");
  }
  return num;
}

export function aggregateSeries(
  aggMode: "sum" | "avg" | "count" | "min" | "max",
  rawValues: unknown[],
  seriesName?: string,
  blockLabel = "Bloco",
): number | null {
  if (aggMode === "count") {
    let count = 0;
    for (const v of rawValues) {
      if (v !== null && v !== undefined && v !== "") {
        count++;
      }
    }
    return count;
  }

  const nums = rawValues.map((v) => parseNumericValue(v, seriesName, blockLabel));
  const valid = nums.filter((n): n is number => n !== null);
  if (valid.length === 0) return null;

  if (aggMode === "sum") {
    return valid.reduce((a, b) => a + b, 0);
  }
  if (aggMode === "avg") {
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
  if (aggMode === "min") {
    return Math.min(...valid);
  }
  if (aggMode === "max") {
    return Math.max(...valid);
  }
  return valid.reduce((a, b) => a + b, 0);
}

export function groupByDate(params: {
  rows: unknown[][];
  xColIndex: number;
  yColIndices: number[];
  groupMode: "day" | "week" | "month" | "quarter" | "year";
  aggMode?: "sum" | "avg" | "count" | "min" | "max";
  seriesNames?: string[];
  blockLabel?: string;
  xColName?: string;
  chartType?: string;
}): { rows: (string | number | null)[][] } {
  const {
    rows: inputRows,
    xColIndex,
    yColIndices,
    groupMode,
    aggMode = "sum",
    seriesNames = [],
    blockLabel = "Gráfico",
    xColName = "Data",
    chartType = "bar",
  } = params;

  type GroupData = {
    sortKey: number;
    label: string;
    seriesLists: unknown[][];
  };

  const groups = new Map<string, GroupData>();

  for (const r of inputRows) {
    const rawVal = r[xColIndex];
    const parsed = parseGroupDate(rawVal, blockLabel, xColName);
    if (!parsed) continue;

    let groupKey = "";
    let sortKey = 0;
    let label = "";

    const { year, month, day, dateObj } = parsed;
    const year2 = String(year).slice(-2);

    if (groupMode === "day") {
      const dayStr = String(day).padStart(2, "0");
      const monthStr = String(month).padStart(2, "0");
      groupKey = `${year}-${monthStr}-${dayStr}`;
      sortKey = dateObj.getTime();
      label = `${dayStr}/${monthStr}/${year}`;
    } else if (groupMode === "week") {
      // Monday of the week
      const dayOfWeek = (dateObj.getDay() + 6) % 7;
      const monday = new Date(dateObj.getTime() - dayOfWeek * 86400000);
      const mDayStr = String(monday.getDate()).padStart(2, "0");
      const mMonthStr = String(monday.getMonth() + 1).padStart(2, "0");
      groupKey = `${monday.getFullYear()}-${mMonthStr}-${mDayStr}`;
      sortKey = monday.getTime();
      label = `sem. ${mDayStr}/${mMonthStr}`;
    } else if (groupMode === "month") {
      groupKey = `${year}-${String(month).padStart(2, "0")}`;
      sortKey = year * 100 + month;
      label = `${PT_MONTHS[month]}/${year2}`;
    } else if (groupMode === "quarter") {
      const q = Math.floor((month - 1) / 3) + 1;
      groupKey = `${year}-Q${q}`;
      sortKey = year * 10 + q;
      label = `T${q}/${year2}`;
    } else if (groupMode === "year") {
      groupKey = `${year}`;
      sortKey = year;
      label = `${year}`;
    } else {
      throw new GroupingError(
        `Bloco "${blockLabel}": agrupamento "${groupMode}" inválido.`,
        "x_group_invalid",
      );
    }

    let grp = groups.get(groupKey);
    if (!grp) {
      grp = {
        sortKey,
        label,
        seriesLists: yColIndices.map(() => []),
      };
      groups.set(groupKey, grp);
    }

    yColIndices.forEach((colIdx, i) => {
      grp!.seriesLists[i].push(r[colIdx]);
    });
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.sortKey - b.sortKey);

  const rows: (string | number | null)[][] = [];
  for (const grp of sortedGroups) {
    const row: (string | number | null)[] = [grp.label];
    yColIndices.forEach((_, i) => {
      const seriesName = seriesNames[i] || `Série ${i + 1}`;
      row.push(aggregateSeries(aggMode, grp.seriesLists[i], seriesName, blockLabel));
    });
    rows.push(row);
  }

  if (rows.length > 500) {
    throw new GroupingError(
      `Gráfico "${blockLabel}": aceita até 500 pontos, mas gerou ${rows.length} pontos. Agrupe por mês ou semana para reduzir os dados.`,
      "chart_points_limit",
    );
  }

  if (chartType === "pie") {
    for (const r of rows) {
      if (typeof r[1] === "number" && r[1] < 0) {
        throw new GroupingError(
          `Gráfico "${blockLabel}": gráfico de pizza não aceita valores negativos.`,
          "pie_negative_value",
        );
      }
    }
  }

  return { rows };
}

export function groupByCategorical(params: {
  rows: unknown[][];
  xColIndex: number;
  yColIndices: number[];
  aggMode: "sum" | "avg" | "count" | "min" | "max";
  seriesNames?: string[];
  blockLabel?: string;
  chartType?: string;
}): { rows: (string | number | null)[][] } {
  const {
    rows: inputRows,
    xColIndex,
    yColIndices,
    aggMode,
    seriesNames = [],
    blockLabel = "Gráfico",
    chartType = "bar",
  } = params;

  type CatGroup = {
    cat: string;
    seriesLists: unknown[][];
  };

  const groups = new Map<string, CatGroup>();
  const order: string[] = [];

  for (const r of inputRows) {
    const cat = String(r[xColIndex] ?? "");
    let grp = groups.get(cat);
    if (!grp) {
      grp = {
        cat,
        seriesLists: yColIndices.map(() => []),
      };
      groups.set(cat, grp);
      order.push(cat);
    }
    yColIndices.forEach((colIdx, i) => {
      grp!.seriesLists[i].push(r[colIdx]);
    });
  }

  const rows: (string | number | null)[][] = [];
  for (const cat of order) {
    const grp = groups.get(cat)!;
    const row: (string | number | null)[] = [cat];
    yColIndices.forEach((_, i) => {
      const seriesName = seriesNames[i] || `Série ${i + 1}`;
      row.push(aggregateSeries(aggMode, grp.seriesLists[i], seriesName, blockLabel));
    });
    rows.push(row);
  }

  if (rows.length > 500) {
    throw new GroupingError(
      `Gráfico "${blockLabel}": aceita até 500 pontos, mas gerou ${rows.length} pontos. Agrupe por mês ou semana para reduzir os dados.`,
      "chart_points_limit",
    );
  }

  if (chartType === "pie") {
    for (const r of rows) {
      if (typeof r[1] === "number" && r[1] < 0) {
        throw new GroupingError(
          `Gráfico "${blockLabel}": gráfico de pizza não aceita valores negativos.`,
          "pie_negative_value",
        );
      }
    }
  }

  return { rows };
}
