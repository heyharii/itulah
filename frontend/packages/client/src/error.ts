/// What went wrong, in the shape the server actually sends it.
///
/// Every route answers a failure with `{"error": "..."}` and a status code, so
/// this carries both. The message is written for a person — the server's error
/// text is the operator's explanation, not a code to be translated again here.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /// Whether retrying could plausibly help.
  ///
  /// A conflict will not resolve itself by asking again: an unpriced item, a
  /// sealed carton, a coupon already spent. A network failure or a server
  /// fault might.
  get worthRetrying(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export async function readError(response: Response): Promise<ApiError> {
  let message = response.statusText || `request failed (${response.status})`;
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // A body that is not JSON tells us nothing the status has not; the
    // statusText above stands.
  }
  return new ApiError(response.status, message);
}
