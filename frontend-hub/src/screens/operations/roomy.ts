/// Goods-flow tables breathe (docs/design-rules-goods-flow.md): a row is at
/// least 64px. Passed as the `className` of a `<DataTable>` whose rows are not
/// virtualised; a virtualised one is given `rowHeight={64}` instead.
export const ROOMY = "[&_tbody_tr]:h-16"
