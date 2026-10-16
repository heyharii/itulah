const buildMarker = process.env.NEXT_FRC_BUILD_MARKER ?? "frc-static-build"

export default function StaticProbePage() {
  return (
    <main
      data-probe="full-route-cache"
      data-build-marker={buildMarker}
      data-records="synthetic-only"
    >
      <h1>Static Full Route Cache probe</h1>
      <p>No ERP, supplier, or client data is rendered on this route.</p>
    </main>
  )
}
