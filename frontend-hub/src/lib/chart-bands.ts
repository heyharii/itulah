/// The one categorical palette a chart may draw a series in.
///
/// Here rather than in `components/ui/chart.tsx` for the reason `filter-chrome`
/// is here: it is a shared constant, and a component file that also exports
/// constants stops hot-reloading cleanly. Nothing about it is UI — it is the
/// list of colours the design language permits a stack to carry, and the order
/// they are handed out in.
///
/// **Five, in this order, and no more.** `<BarSeries>` takes a role and never a
/// hue, which is what keeps a fourth colour out of the ordinary chart;
/// `<BandStack>` is the one exception, and it is drawn narrowly: one shop per
/// band, at most five of them, everything else as Other. A fleet of thirteen
/// shops cannot be told apart by hue, and a chart that tries hands the reader
/// thirteen pastels and a legend they have to keep re-reading.
///
/// The order was picked by running the palette through a colour-blindness check
/// rather than by eye: orange, blue, green, violet, pink separates every
/// adjacent pair for protanopia and deuteranopia (worst ΔE 14.8 in OKLab×100).
/// Reordering breaks that — green beside pink comes out at ΔE 5.1, which is two
/// shops nobody can tell apart. Orange is also under 3:1 against white on its
/// own, which is why the legend naming every band is not optional and why the
/// table under the chart carries every figure.
export const BAND_TONES: readonly string[] = [
  "var(--a-orange)",
  "var(--a-blue)",
  "var(--a-green)",
  "var(--a-violet)",
  "var(--a-pink)",
]

/// The remainder. A neutral rather than a sixth hue, because "Other" is not a
/// sixth thing — it is everything that did not get its own.
///
/// `{mute}` and not `{faint}`: the tail of a thirteen-shop fleet is nearly half
/// its trade, and at the paler grey that band read as empty space above the
/// column rather than as the largest thing in it.
export const BAND_NEUTRAL = "var(--mute)"
