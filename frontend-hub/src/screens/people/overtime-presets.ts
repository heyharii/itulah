/// Kepmenaker 102/2004's overtime pay, as pay components. The rest-day and
/// holiday tiers past the first carry only the *extra* multiplier, because
/// their bands count every minute already at 2× (0808).
export const KEPMEN_102 = [
  {
    code: "LEMBUR_JAM_1",
    label: "Lembur jam pertama",
    unit: "OVERTIME_WORKDAY_FIRST_HOUR",
    multiplierBp: 15_000,
    rule: "workday, first hour",
  },
  {
    code: "LEMBUR_JAM_LANJUT",
    label: "Lembur jam berikutnya",
    unit: "OVERTIME_WORKDAY_LATER",
    multiplierBp: 20_000,
    rule: "workday, later hours",
  },
  {
    code: "LEMBUR_ISTIRAHAT",
    label: "Lembur hari istirahat",
    unit: "OVERTIME_REST_DAY",
    multiplierBp: 20_000,
    rule: "rest day, every hour",
  },
  {
    code: "LEMBUR_ISTIRAHAT_TINGKAT_2",
    label: "Lembur hari istirahat, jam setelah tingkat pertama",
    unit: "OVERTIME_REST_DAY_NEXT_HOUR",
    multiplierBp: 10_000,
    rule: "rest day, next hour (+1×, 3× in all)",
  },
  {
    code: "LEMBUR_ISTIRAHAT_TINGKAT_3",
    label: "Lembur hari istirahat, jam selanjutnya",
    unit: "OVERTIME_REST_DAY_BEYOND",
    multiplierBp: 20_000,
    rule: "rest day, beyond (+2×, 4× in all)",
  },
  {
    code: "LEMBUR_LIBUR",
    label: "Lembur hari libur",
    unit: "OVERTIME_HOLIDAY",
    multiplierBp: 20_000,
    rule: "holiday, every hour",
  },
  {
    code: "LEMBUR_LIBUR_TINGKAT_2",
    label: "Lembur hari libur, jam setelah tingkat pertama",
    unit: "OVERTIME_HOLIDAY_NEXT_HOUR",
    multiplierBp: 10_000,
    rule: "holiday, next hour (+1×, 3× in all)",
  },
  {
    code: "LEMBUR_LIBUR_TINGKAT_3",
    label: "Lembur hari libur, jam selanjutnya",
    unit: "OVERTIME_HOLIDAY_BEYOND",
    multiplierBp: 20_000,
    rule: "holiday, beyond (+2×, 4× in all)",
  },
] as const
