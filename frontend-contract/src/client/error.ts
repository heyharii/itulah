/// What went wrong, in the shape the server actually sends it.
///
/// Every route answers a failure with `{"error": "..."}` and a status code, so
/// this carries both. The message is written for a person — the server's error
/// text is the operator's explanation, not a code to be translated again here.
export class ApiError extends Error {
  readonly status: number;

  /// A machine-readable reason, when the server sends one beside its sentence
  /// — sandbox tenancy's `business_required` / `business_unknown` are the
  /// first callers that need one. Most routes answer with only `error` and
  /// this stays `undefined`; a caller that must distinguish one specific
  /// refusal from the rest checks this rather than parsing the sentence.
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /// Whether retrying could plausibly help.
  ///
  /// A conflict will not resolve itself by asking again: an unpriced item, a
  /// sealed carton, a coupon already spent. A network failure or a server
  /// fault might.
  get worthRetrying(): boolean {
    return this.status === 0 || this.status >= 500;
  }

  /// Nobody is signed in, or the session has lapsed. The caller's business is
  /// to show the sign-in screen, not to retry.
  get needsSignIn(): boolean {
    return this.status === 401;
  }
}

export async function readError(response: Response): Promise<ApiError> {
  let message = response.statusText || `request failed (${response.status})`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") {
        message = record.error;
      }
      if (typeof record.code === "string") {
        code = record.code;
      }
    }
  } catch {
    // A body that is not JSON tells us nothing the status has not; the
    // statusText above stands.
  }
  return new ApiError(response.status, message, code);
}
