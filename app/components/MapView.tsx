// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { NavState, Point } from '../hooks/useNavigation';
import { MAP } from '../lib/mapPack';

interface MapViewProps {
  nav: NavState;
  path: Point[];
  useDarkMap: boolean;
  showWalls: boolean;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Image pixel coordinates: origin at the top-left corner, y pointing down */
  onMapTap: (p: Point) => void;
}

export interface MapViewHandle {
  /** Zoom around the screen centre (factor > 1: zoom in) */
  zoom: (factor: number) => void;
}

const BACKGROUND = { dark: '#000000', light: '#FFFFFF' };

/**
 * Tiled map displayed by Leaflet inside a WebView. Tiles and Leaflet live in the Android assets
 * (plugins/withMapAssets.js): no network resource at all, works underground.
 * Path, position and heading cone are Leaflet layers; the particles, being many, are drawn on a
 * dedicated canvas.
 */
export default forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { nav, path, useDarkMap, showWalls, follow, onFollowChange, onMapTap },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const sentPathLength = useRef(0);

  const send = (msg: object) => {
    webViewRef.current?.injectJavaScript(`window.gpsnt && window.gpsnt.update(${JSON.stringify(msg)}); true;`);
  };

  useImperativeHandle(ref, () => ({ zoom: (factor: number) => send({ zoom: factor }) }), []);

  useEffect(() => {
    if (ready) send({ theme: useDarkMap ? 'dark' : 'light', showWalls });
  }, [useDarkMap, showWalls, ready]);

  // The path is sent incrementally (it can hold thousands of points)
  useEffect(() => {
    if (!ready) return;
    if (path.length < sentPathLength.current || sentPathLength.current === 0) {
      send({ pathReset: path.map((p) => [p.x, p.y]) });
    } else if (path.length > sentPathLength.current) {
      send({ pathAppend: path.slice(sentPathLength.current).map((p) => [p.x, p.y]) });
    }
    sentPathLength.current = path.length;
  }, [path, ready]);

  useEffect(() => {
    if (!ready) return;
    send({
      position: nav.position ? [nav.position.x, nav.position.y] : null,
      angle: nav.displayAngle,
      uncertainty: nav.uncertaintyPx,
      particles: nav.particles,
    });
  }, [nav, ready]);

  useEffect(() => {
    if (ready) send({ follow });
  }, [follow, ready]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'tap') onMapTap({ x: data.x, y: data.y });
      else if (data.type === 'follow') onFollowChange(data.value);
      else if (data.type === 'ready') {
        sentPathLength.current = 0;
        setReady(true);
      } else if (data.type === 'error') console.warn('Map:', data.message);
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  };

  // The page is built once: theme and layers follow through messages
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildHtml(useDarkMap ? 'dark' : 'light', showWalls), []);
  const background = useDarkMap ? BACKGROUND.dark : BACKGROUND.light;

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: 'file:///android_asset/' }}
        style={[styles.container, { backgroundColor: background }]}
        onMessage={handleMessage}
        javaScriptEnabled
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        setBuiltInZoomControls={false}
        overScrollMode="never"
      />
    </View>
  );
});

function buildHtml(theme: 'dark' | 'light', showWalls: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="map/leaflet/leaflet.css" />
<style>
  html, body, #map { margin: 0; height: 100%; }
  body.dark, body.dark #map { background: ${BACKGROUND.dark}; }
  body.light, body.light #map { background: ${BACKGROUND.light}; }
  .leaflet-container { outline: 0; }
  #particles { position: absolute; left: 0; top: 0; pointer-events: none; }
</style>
</head>
<body class="${theme}">
<div id="map"></div>
<script src="map/leaflet/leaflet.js"></script>
<script>
(function () {
  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  window.onerror = function (m) { post({ type: 'error', message: String(m) }); };

  var W = ${MAP.width}, H = ${MAP.height}, Z = ${MAP.maxZoom}, T = ${MAP.tileSize};
  // At zoom Z, one map unit = one image pixel; latLng = [y, x] (y pointing down)
  var crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1 / (1 << Z), 0, 1 / (1 << Z), 0) });
  var bounds = L.latLngBounds([0, 0], [H, W]);
  var map = L.map('map', {
    crs: crs, minZoom: 0, maxZoom: Z + 2, zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,
    zoomControl: false, attributionControl: false, maxBounds: bounds.pad(0.25), maxBoundsViscosity: 0.9,
  });
  var tileOptions = { tileSize: T, minZoom: 0, maxZoom: Z + 2, maxNativeZoom: Z, bounds: bounds, noWrap: true, keepBuffer: 3 };
  var theme = '${theme}';
  var base = L.tileLayer('map/tiles/' + theme + '/{z}/{x}/{y}.webp', tileOptions).addTo(map);
  var walls = L.tileLayer('map/tiles/walls/{z}/{x}/{y}.webp', tileOptions);
  if (${showWalls}) walls.addTo(map);
  map.fitBounds(bounds);
  map.setMinZoom(map.getZoom() - 0.5);

  var renderer = L.canvas({ padding: 0.5 });
  var pathLine = L.polyline([], { renderer: renderer, color: '#4F9BFF', weight: 3, lineJoin: 'round', interactive: false }).addTo(map);
  var halo = L.circle([0, 0], { renderer: renderer, radius: 0, stroke: false, fillColor: '#e53935', fillOpacity: 0.12, interactive: false });
  var cone = L.polygon([], { renderer: renderer, stroke: false, fillColor: '#e53935', fillOpacity: 0.35, interactive: false });
  var dot = L.circleMarker([0, 0], { renderer: renderer, radius: 7, color: '#fff', weight: 2, fillColor: '#e53935', fillOpacity: 1, interactive: false });

  // Particles: full-screen canvas in a pane below the path, redrawn on every move
  var pane = map.createPane('particles');
  pane.style.zIndex = 350;
  var canvas = L.DomUtil.create('canvas', '', pane);
  canvas.id = 'particles';
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  var state = { position: null, angle: 0, uncertainty: 0, particles: [], follow: false };

  function ll(p) { return L.latLng(p[1], p[0]); }

  function drawParticles() {
    var size = map.getSize();
    canvas.width = size.x * dpr;
    canvas.height = size.y * dpr;
    canvas.style.width = size.x + 'px';
    canvas.style.height = size.y + 'px';
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    var q = state.particles;
    if (!q.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(255,152,0,0.65)';
    for (var j = 0; j < q.length; j += 2) {
      var c = map.latLngToContainerPoint([q[j + 1], q[j]]);
      ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
    }
  }

  function drawPosition() {
    if (!state.position) {
      [halo, cone, dot].forEach(function (l) { l.remove(); });
      return;
    }
    var p = ll(state.position), x = state.position[0], y = state.position[1];
    halo.setLatLng(p).setRadius(state.uncertainty).addTo(map);
    // Heading cone: clockwise angle from the image top, fixed on-screen length
    var len = 40 / map.getZoomScale(map.getZoom(), Z), a = state.angle, half = 0.4;
    cone.setLatLngs([p,
      L.latLng(y - len * Math.cos(a - half), x + len * Math.sin(a - half)),
      L.latLng(y - len * Math.cos(a + half), x + len * Math.sin(a + half))]).addTo(map);
    dot.setLatLng(p).addTo(map);
  }

  map.on('move zoom resize', drawParticles);
  map.on('zoomanim', function () { canvas.style.visibility = 'hidden'; });
  map.on('zoomend', function () { canvas.style.visibility = ''; drawParticles(); drawPosition(); });

  // Dragging the map suspends follow mode; zooming does not
  map.on('dragstart', function () {
    if (state.follow) { state.follow = false; post({ type: 'follow', value: false }); }
  });
  map.on('click', function (e) { post({ type: 'tap', x: e.latlng.lng, y: e.latlng.lat }); });

  function center() {
    if (state.follow && state.position) map.setView(ll(state.position), map.getZoom(), { animate: false });
  }

  window.gpsnt = {
    update: function (msg) {
      if (msg.theme && msg.theme !== theme) {
        theme = msg.theme;
        document.body.className = theme;
        // New layer rather than setUrl(): the latter redraws at a non-integer zoom (zoomSnap 0)
        base.remove();
        base = L.tileLayer('map/tiles/' + theme + '/{z}/{x}/{y}.webp', tileOptions).addTo(map);
        if (walls._map) walls.bringToFront();
      }
      if ('showWalls' in msg) { if (msg.showWalls) walls.addTo(map); else walls.remove(); }
      if (msg.pathReset) pathLine.setLatLngs(msg.pathReset.map(ll));
      if (msg.pathAppend) msg.pathAppend.forEach(function (p) { pathLine.addLatLng(ll(p)); });
      if ('position' in msg) state.position = msg.position;
      if ('angle' in msg) state.angle = msg.angle;
      if ('uncertainty' in msg) state.uncertainty = msg.uncertainty;
      if ('particles' in msg) state.particles = msg.particles;
      if ('follow' in msg) {
        var resumed = msg.follow && !state.follow;
        state.follow = msg.follow;
        // Resuming follow mode from an overview: zoom in to see the corridors
        if (resumed && state.position && map.getZoom() < Z - 2) map.setView(ll(state.position), Z - 1, { animate: false });
      }
      if (msg.zoom) map.setZoom(map.getZoom() + Math.log2(msg.zoom));
      center();
      drawPosition();
      drawParticles();
    }
  };

  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
