/**
 * OSRS live map: Explv TMS tiles + game-tile ↔ Leaflet conversion (Explv tile grid).
 */
(function (global) {
  if (typeof L === "undefined") return;

  const MAP_HEIGHT_MAX_ZOOM_PX = 364544;
  const RS_TILE_WIDTH_PX = 32;
  const RS_TILE_HEIGHT_PX = 32;
  const RS_OFFSET_X = 1024 - 64;
  const RS_OFFSET_Y = 6208;

  class Position {
    constructor(x, y, z) {
      this.x = Math.round(x);
      this.y = Math.round(y);
      this.z = z;
    }

    static toLatLng(map, x, y) {
      const px = ((x - RS_OFFSET_X) * RS_TILE_WIDTH_PX) + RS_TILE_WIDTH_PX / 4;
      const py = MAP_HEIGHT_MAX_ZOOM_PX - ((y - RS_OFFSET_Y) * RS_TILE_HEIGHT_PX);
      return map.unproject(L.point(px, py), map.getMaxZoom());
    }

    toCentreLatLng(map) {
      return Position.toLatLng(map, this.x + 0.5, this.y + 0.5);
    }
  }

  const EXPV_BASE = "https://raw.githubusercontent.com/Explv/osrs_map_tiles/master";

  let map = null;
  let tileLayer = null;
  let markerLayer = null;
  let mapPlane = 0;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateTilePath() {
    if (!map) return;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    tileLayer = L.tileLayer(`${EXPV_BASE}/${mapPlane}/{z}/{x}/{y}.png`, {
      minZoom: 7,
      maxZoom: 11,
      noWrap: true,
      tms: true,
      fadeAnimation: false,
    });
    tileLayer.addTo(map);
  }

  function makePlayerIcon() {
    return L.divIcon({
      className: "live-map-marker-wrap",
      html: '<span class="live-map-marker-dot"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function ensureMap(containerId, opts) {
    const plane = Math.min(3, Math.max(0, Number(opts?.plane) || 0));

    if (map) {
      const planeChanged = plane !== mapPlane || !tileLayer;
      mapPlane = plane;
      if (planeChanged) updateTilePath();
      map.invalidateSize();
      return map;
    }

    mapPlane = plane;

    const el = document.getElementById(containerId);
    if (!el) return null;

    map = L.map(el, {
      maxZoom: 11,
      minZoom: 7,
      zoomControl: false,
      attributionControl: false,
    }).setView([-79, -137], 8);

    markerLayer = L.layerGroup().addTo(map);
    updateTilePath();
    return map;
  }

  function setPlane(plane) {
    const next = Math.min(3, Math.max(0, Number(plane) || 0));
    if (!map) {
      mapPlane = next;
      return;
    }
    if (tileLayer && next === mapPlane) return;
    mapPlane = next;
    updateTilePath();
  }

  function setMarkers(players) {
    if (!markerLayer || !map) return;
    markerLayer.clearLayers();
    const list = Array.isArray(players) ? players : [];
    for (const pl of list) {
      const x = Number(pl.x);
      const y = Number(pl.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const name = pl.displayName || pl.name || "?";
      const m = L.marker(new Position(x, y, 0).toCentreLatLng(map), { icon: makePlayerIcon() });
      m.bindTooltip(`<span class="live-map-tip-inner">${esc(name)}</span>`, {
        permanent: true,
        direction: "top",
        className: "live-map-tooltip",
        offset: [0, -6],
      });
      m.on("click", () => map.flyTo(m.getLatLng(), 10));
      m.addTo(markerLayer);
    }
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  function fitToMarkersIfAny() {
    if (!map || !markerLayer) return;
    const b = markerLayer.getBounds();
    if (!b.isValid()) return;
    map.fitBounds(b, { padding: [96, 96], maxZoom: 10, animate: true });
  }

  function flyToGameTile(x, y) {
    if (!map) return;
    const pos = new Position(Number(x), Number(y), 0);
    map.flyTo(pos.toCentreLatLng(map), 10);
  }

  global.TerpinheimerOsrsMap = {
    ensureMap,
    setPlane,
    setMarkers,
    invalidateSize,
    fitToMarkersIfAny,
    flyToGameTile,
    getMap: () => map,
  };
})(window);
