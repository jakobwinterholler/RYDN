type IncomingGpxListener = (file: File) => void;

let listener: IncomingGpxListener | null = null;
let pendingFile: File | null = null;

const SHARE_IMPORT_CACHE = "share-import-v1";
const SHARE_IMPORT_KEY = "/pending.gpx";

export function onIncomingGpxFile(next: IncomingGpxListener | null): void {
  listener = next;
  if (listener && pendingFile) {
    listener(pendingFile);
    pendingFile = null;
  }
}

function deliverIncomingFile(file: File): void {
  if (!acceptGpxFile(file)) {
    return;
  }
  if (listener) {
    listener(file);
    return;
  }
  pendingFile = file;
}

export function registerLaunchQueueConsumer(): void {
  if (typeof window === "undefined") {
    return;
  }
  const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  if (!launchQueue?.setConsumer) {
    return;
  }
  launchQueue.setConsumer(async (params: LaunchParams) => {
    const files = params.files ?? [];
    if (files.length === 0) {
      return;
    }
    const handle = files[0];
    const file = await handle.getFile();
    deliverIncomingFile(file);
  });
}

function extractGpxUrl(params: URLSearchParams): string | null {
  const direct = params.get("url")?.trim();
  if (direct && /\.gpx(\?|$)/i.test(direct)) {
    return direct;
  }
  const text = params.get("text")?.trim();
  if (text && /^https?:\/\/.+\.gpx(\?.*)?$/i.test(text)) {
    return text;
  }
  const title = params.get("title")?.trim();
  if (title && /^https?:\/\/.+\.gpx(\?.*)?$/i.test(title)) {
    return title;
  }
  return null;
}

async function fetchGpxFromUrl(url: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").pop() || "shared-route.gpx";
    return new File([blob], name.endsWith(".gpx") ? name : `${name}.gpx`, {
      type: blob.type || "application/gpx+xml",
    });
  } catch {
    return null;
  }
}

/** Read a GPX shared via Web Share Target GET params or cached POST import. */
export async function consumeSharedGpxImport(): Promise<File | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const sharedFlag = params.get("shared");
  if (sharedFlag === "gpx" && typeof caches !== "undefined") {
    try {
      const cache = await caches.open(SHARE_IMPORT_CACHE);
      const cached = await cache.match(SHARE_IMPORT_KEY);
      if (cached) {
        const blob = await cached.blob();
        await cache.delete(SHARE_IMPORT_KEY);
        const file = new File([blob], "shared-route.gpx", {
          type: blob.type || "application/gpx+xml",
        });
        if (acceptGpxFile(file)) {
          return file;
        }
      }
    } catch {
      // fall through
    }
  }

  const importFlag = params.get("import");
  if (importFlag !== "gpx") {
    return null;
  }

  const gpxUrl = extractGpxUrl(params);
  if (!gpxUrl) {
    return null;
  }

  return fetchGpxFromUrl(gpxUrl);
}

export function acceptGpxFile(file: File | null | undefined): boolean {
  if (!file) {
    return false;
  }
  const nameOk = file.name.toLowerCase().endsWith(".gpx");
  const typeOk =
    !file.type ||
    file.type === "application/gpx+xml" ||
    file.type === "application/xml" ||
    file.type === "text/xml" ||
    file.type === "application/octet-stream";
  return nameOk && typeOk;
}

export function queueIncomingGpxFile(file: File): void {
  deliverIncomingFile(file);
}

interface FileSystemFileHandle extends FileSystemHandle {
  getFile: () => Promise<File>;
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void | Promise<void>) => void;
}
