/// Where the phone is, asked of the browser once per punch.
///
/// Only when the company needs it — a fence to check or a location required —
/// and never kept by the app: it goes with the punch and nowhere else.
export function whereAmI(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("This device cannot say where it is."))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Allow location for this app to punch from your phone."
              : "Your location could not be found. Step outside or try again."
          )
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    )
  })
}
