/** Map API / network failures to calm, actionable copy. Never show stack traces. */

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const STATUS_COPY: Record<number, string> = {
  0: "You appear to be offline. Check your connection and try again.",
  401: "Your session expired. Sign in again to continue.",
  403: "You don’t have permission to do that.",
  404: "We couldn’t find that. It may have been removed.",
  408: "The request timed out. Check your connection and try again.",
  409: "That ride already belongs to another trip. Remove it there first, or choose a different day.",
  413: "That file is too large. Try a smaller export (under 80 MB).",
  422: "We couldn’t use that data. Re-export the file or re-sync the activity.",
  429: "Too many requests. Wait a minute, then try again.",
  500: "Something went wrong on our side. Please try again in a moment.",
  502: "A connected service is unavailable. Try again shortly.",
  503: "Service temporarily unavailable. Please try again shortly.",
  504: "The request timed out. Check your connection and try again.",
};

/** Prefer server detail when it looks human; otherwise status fallback. */
export function userMessageFromDetail(detail: unknown, status: number, fallback: string): string {
  const fromStatus = STATUS_COPY[status];
  if (typeof detail === "string" && detail.trim()) {
    const t = detail.trim();
    // Reject technical dumps
    if (/traceback|exception|stack|at 0x|TypeError|KeyError|NoneType/i.test(t)) {
      return fromStatus || fallback;
    }
    if (t.length > 280) return fromStatus || fallback;
    return t;
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .slice(0, 2)
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  return fromStatus || fallback;
}

export function networkErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) {
    return STATUS_COPY[0];
  }
  if (err instanceof Error && err.message) {
    if (/failed to fetch|networkerror|load failed|offline/i.test(err.message)) {
      return STATUS_COPY[0];
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}
