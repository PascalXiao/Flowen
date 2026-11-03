/**
 * 日期用“天号”表示：自 1970-01-01 起的整天数，按日历日期计算，不带时区。
 * 存库时换成该日期 UTC 零点的时间戳；界面按日期显示，不随浏览器时区漂移。
 */
export type Day = number;

const MS_PER_DAY = 86_400_000;

export function dayFromDate(date: Date | number): Day {
  return Math.floor((typeof date === "number" ? date : date.getTime()) / MS_PER_DAY);
}

export function dayToTimestamp(day: Day): number {
  return day * MS_PER_DAY;
}

/** 'YYYY-MM-DD' ↔ 天号。 */
export function dayFromIso(iso: string): Day {
  return dayFromDate(Date.parse(`${iso}T00:00:00Z`));
}

export function dayToIso(day: Day): string {
  return new Date(dayToTimestamp(day)).toISOString().slice(0, 10);
}

/** 某个时刻在给定时区里是哪一天（比如“今天”、工作项创建的那天）。 */
export function dayInTimeZone(at: Date | number, timeZone: string): Day {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return dayFromIso(parts);
}

export interface CalendarOptions {
  /** 放假的日期（包括落在工作日的法定节假日）。 */
  holidays?: Iterable<Day>;
  /** 调休上班的周末。 */
  extraWorkdays?: Iterable<Day>;
}

/** 存库的日历配置：日期都是 'YYYY-MM-DD'。 */
export interface CalendarConfig {
  holidays: string[];
  extraWorkdays: string[];
}

/** 工作日历：默认周一到周五上班，可以叠加节假日和调休。 */
export class WorkCalendar {
  private readonly holidays: Set<Day>;
  private readonly extraWorkdays: Set<Day>;

  constructor(options: CalendarOptions = {}) {
    this.holidays = new Set(options.holidays ?? []);
    this.extraWorkdays = new Set(options.extraWorkdays ?? []);
  }

  static fromConfig(config: Partial<CalendarConfig> | null | undefined): WorkCalendar {
    return new WorkCalendar({
      holidays: (config?.holidays ?? []).map(dayFromIso),
      extraWorkdays: (config?.extraWorkdays ?? []).map(dayFromIso),
    });
  }

  isWorkday(day: Day): boolean {
    if (this.extraWorkdays.has(day)) return true;
    if (this.holidays.has(day)) return false;
    // 1970-01-01 是周四：(day + 4) % 7 得到 0=周日 … 6=周六
    const weekday = (((day + 4) % 7) + 7) % 7;
    return weekday !== 0 && weekday !== 6;
  }

  /** 当天或之后的第一个工作日。 */
  onOrAfter(day: Day): Day {
    let d = day;
    while (!this.isWorkday(d)) d++;
    return d;
  }

  /** 从某个工作日起往后数 n 个工作日（n=0 返回它自己）。 */
  addWorkdays(day: Day, n: number): Day {
    let d = this.onOrAfter(day);
    for (let left = n; left > 0; left--) d = this.onOrAfter(d + 1);
    return d;
  }

  /** 当天或之前的最后一个工作日。 */
  onOrBefore(day: Day): Day {
    let d = day;
    while (!this.isWorkday(d)) d--;
    return d;
  }

  /** 往前（n 为负）或往后数 n 个工作日；起点不是工作日时先挪到最近的工作日。 */
  offsetWorkdays(day: Day, n: number): Day {
    if (n >= 0) return this.addWorkdays(day, n);
    let d = this.onOrBefore(day);
    for (let left = -n; left > 0; left--) d = this.onOrBefore(d - 1);
    return d;
  }

  /** 两个日期之间（含首尾）的工作日数。 */
  workdaysBetween(start: Day, end: Day): number {
    let count = 0;
    for (let d = start; d <= end; d++) if (this.isWorkday(d)) count++;
    return count;
  }
}
