/*
 * MaDo's service worker: what makes the panel an installable app.
 *
 * Two jobs only. The page itself is fetched from the network first and kept
 * as a fallback, so an update of the add-on shows at the next opening and a
 * dropped connection still opens the app (with an error instead of a blank
 * screen). The API is never touched: answers, files and memory always come
 * from the server.
 *
 * And the share target: Android's "Share" menu posts the shared files and
 * text here (manifest.webmanifest, share_target). They are kept in a cache
 * for a moment and the app opens on "./?share=1", which picks them up and
 * puts them in the composer of a new thread.
 */

var SHELL = "mado-shell-v2";
var SHARE = "mado-share-v1";
var SHELL_FILES = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== SHARE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

var scope = new URL(self.registration.scope);

function inScope(url) {
  return url.origin === scope.origin && url.pathname.indexOf(scope.pathname) === 0;
}

function receiveShare(request) {
  return request.formData()
    .then(function (form) {
      return caches.delete(SHARE).then(function () { return caches.open(SHARE); }).then(function (cache) {
        var files = form.getAll("files").filter(function (f) { return f && typeof f !== "string" && f.size; });
        var meta = {
          title: String(form.get("title") || ""),
          text: String(form.get("text") || ""),
          url: String(form.get("url") || ""),
          files: files.map(function (f, i) { return { key: "share/file/" + i, name: f.name || "fichier", type: f.type || "" }; }),
          at: Date.now(),
        };
        return Promise.all(files.map(function (f, i) {
          return cache.put(new Request(scope.href + "share/file/" + i), new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
        })).then(function () {
          return cache.put(new Request(scope.href + "share/meta"), new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
        });
      });
    })
    .catch(function () {})
    .then(function () { return Response.redirect(scope.href + "?share=1", 303); });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (!inScope(url)) return;
  var path = url.pathname.slice(scope.pathname.length);

  if (request.method === "POST" && path === "share") {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET" || path.indexOf("api/") === 0) return;

  var isPage = request.mode === "navigate";
  var isShell = isPage || SHELL_FILES.indexOf(path) >= 0;
  if (!isShell) return;

  event.respondWith(
    fetch(request)
      .then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(SHELL).then(function (cache) { cache.put(isPage ? scope.href : request, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(isPage ? scope.href : request).then(function (hit) {
          return hit || new Response("MaDo est injoignable pour le moment.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        });
      })
  );
});
