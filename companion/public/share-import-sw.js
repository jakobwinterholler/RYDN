const SHARE_IMPORT_CACHE = "share-import-v1";
const SHARE_IMPORT_KEY = "/pending.gpx";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "POST") {
    return;
  }

  const url = new URL(request.url);
  const isShareImport =
    url.searchParams.get("import") === "gpx" ||
    (url.pathname === "/" && request.headers.get("content-type")?.includes("multipart/form-data"));

  if (!isShareImport) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const formData = await request.formData();
        const fileEntry = formData.get("gpx");
        if (fileEntry instanceof File && fileEntry.name.toLowerCase().endsWith(".gpx")) {
          const cache = await caches.open(SHARE_IMPORT_CACHE);
          await cache.put(SHARE_IMPORT_KEY, new Response(await fileEntry.arrayBuffer(), {
            headers: { "Content-Type": fileEntry.type || "application/gpx+xml" },
          }));
          return Response.redirect("/?shared=gpx", 303);
        }
      } catch {
        // fall through to home
      }
      return Response.redirect("/", 303);
    })(),
  );
});
