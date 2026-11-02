/**
 * Deterministic Date Range Helper for Reporting & Analytics.
 * Provides timezone-safe date bounding and prior-period matching for comparative deltas.
 */

export interface DateRangePeriod {
  start: Date;
  end: Date;
  preset: string;
}

export interface ComparativeDateRange {
  current: DateRangePeriod;
  previous: DateRangePeriod;
}

const MAX_CUSTOM_RANGE_DAYS = 366;

export function parseReportDateRange(
  preset?: string,
  customStart?: string | null,
  customEnd?: string | null,
  referenceDate = new Date()
): ComparativeDateRange {
  const normalizedPreset = (preset || (customStart ? "custom" : "this_month")).toLowerCase().trim();
  const now = new Date(referenceDate);

  let start: Date;
  let end: Date;

  switch (normalizedPreset) {
    case "today": {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case "yesterday": {
      start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case "this_week": {
      // Week starting on Monday
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      start = new Date(now);
      start.setDate(now.getDate() + diffToMonday);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case "last_week": {
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      end = new Date(now);
      end.setDate(now.getDate() + diffToMonday - 1);
      end.setHours(23, 59, 59, 999);
      start = new Date(end);
      start.setDate(end.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    }

    case "last_month": {
      const year = now.getFullYear();
      const month = now.getMonth();
      start = new Date(year, month - 1, 1, 0, 0, 0, 0);
      end = new Date(year, month, 0, 23, 59, 59, 999);
      break;
    }

    case "quarter": {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), currentQuarter * 3, 1, 0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case "year": {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case "custom": {
      if (customStart) {
        const parsedStart = new Date(customStart);
        if (!isNaN(parsedStart.getTime())) {
          start = parsedStart;
          start.setHours(0, 0, 0, 0);
        } else {
          start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        }
      } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      }

      if (customEnd) {
        const parsedEnd = new Date(customEnd);
        if (!isNaN(parsedEnd.getTime())) {
          end = parsedEnd;
          end.setHours(23, 59, 59, 999);
        } else {
          end = new Date(now);
          end.setHours(23, 59, 59, 999);
        }
      } else {
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
      }

      // Ensure start <= end
      if (start > end) {
        const temp = start;
        start = end;
        end = temp;
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
      }

      // Enforce max bounds
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_CUSTOM_RANGE_DAYS) {
        start = new Date(end.getTime() - MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000);
        start.setHours(0, 0, 0, 0);
      }
      break;
    }

    case "this_month":
    default: {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
      break;
    }
  }

  // Calculate previous period with matching duration
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  prevStart.setHours(0, 0, 0, 0);

  return {
    current: {
      start,
      end,
      preset: normalizedPreset,
    },
    previous: {
      start: prevStart,
      end: prevEnd,
      preset: `prev_${normalizedPreset}`,
    },
  };
}

/**
 * Calculates percentage change with safe zero handling.
 */
export function calculateDelta(current: number, previous: number): { value: number; percentage: number; isPositive: boolean } {
  const value = current - previous;
  if (previous === 0) {
    return {
      value,
      percentage: current > 0 ? 100 : 0,
      isPositive: value >= 0,
    };
  }
  const percentage = Math.round(((current - previous) / previous) * 100 * 10) / 10;
  return {
    value,
    percentage,
    isPositive: percentage >= 0,
  };
}
