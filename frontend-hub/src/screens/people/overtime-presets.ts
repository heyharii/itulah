/// Kepmenaker 102/2004's overtime pay, as pay components. The rest-day and
/// holiday tiers past the first carry only the *extra* multiplier, because
/// their bands count every minute already at 2× (0808).
export const KEPMEN_102 = [
  {
    code: "LEMBUR_JAM_1",
    label: "Overtime, first hour",
    unit: "OVERTIME_WORKDAY_FIRST_HOUR",
    multiplierBp: 15_000,
    rule: "workday, first hour",
  },
  {
    code: "LEMBUR_JAM_LANJUT",
    label: "Overtime, later hours",
    unit: "OVERTIME_WORKDAY_LATER",
    multiplierBp: 20_000,
    rule: "workday, later hours",
  },
  {
    code: "LEMBUR_ISTIRAHAT",
    label: "Overtime, rest day",
    unit: "OVERTIME_REST_DAY",
    multiplierBp: 20_000,
    rule: "rest day, every hour",
  },
  {
    code: "LEMBUR_ISTIRAHAT_TINGKAT_2",
    label: "Overtime, rest day, hour after the first tier",
    unit: "OVERTIME_REST_DAY_NEXT_HOUR",
    multiplierBp: 10_000,
    rule: "rest day, next hour (+1×, 3× in all)",
  },
  {
    code: "LEMBUR_ISTIRAHAT_TINGKAT_3",
    label: "Overtime, rest day, later hours",
    unit: "OVERTIME_REST_DAY_BEYOND",
    multiplierBp: 20_000,
    rule: "rest day, beyond (+2×, 4× in all)",
  },
  {
    code: "LEMBUR_LIBUR",
    label: "Overtime, holiday",
    unit: "OVERTIME_HOLIDAY",
    multiplierBp: 20_000,
    rule: "holiday, every hour",
  },
  {
    code: "LEMBUR_LIBUR_TINGKAT_2",
    label: "Overtime, holiday, hour after the first tier",
    unit: "OVERTIME_HOLIDAY_NEXT_HOUR",
    multiplierBp: 10_000,
    rule: "holiday, next hour (+1×, 3× in all)",
  },
  {
    code: "LEMBUR_LIBUR_TINGKAT_3",
    label: "Overtime, holiday, later hours",
    unit: "OVERTIME_HOLIDAY_BEYOND",
    multiplierBp: 20_000,
    rule: "holiday, beyond (+2×, 4× in all)",
  },
] as const
