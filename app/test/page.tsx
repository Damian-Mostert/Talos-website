'use client';

import { useEffect, useRef } from "react";

/**
 * NeuronPulseLoader
 * A flat 2D, non-spinning loading indicator that grows like a neuron
 * network -- a cluster of "spokes" radiating outward from a center in
 * ALL directions (evenly spread around the full circle), each spoke
 * continuing outward and occasionally forking into local twigs.
 *
 * As the network's real extent grows, the whole rendering is rescaled
 * down (a camera "zoom out") so it always stays contained inside the
 * canvas, instead of individual pieces shrinking on their own.
 *
 * No required props -- drop it in anywhere.
 */
export default function NeuronPulseLoader({
  size = 50,          // canvas box size in px (square)
  cap = 30,            // max simultaneous nodes (controls density/perf)
  spokes = 12,           // target number of primary directions from center
  background = "transparent",
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ---- world-space network state (unbounded, never clamped) ----
    let nodes = [];
    let nextId = 0;
    let scale = 1; // current fit-to-frame scale, eased toward target each frame

    function makeRoot() {
      nodes = [{
        id: nextId++,
        x: 0, y: 0,
        parent: null,
        children: [],
        dirAngle: 0,
        depth: 0,
        baseR: 8,
        born: -1e6,
      }];
    }
    makeRoot();

    // pick the angle (0..2PI) that is furthest from every existing
    // primary spoke direction -- this is what keeps growth spread
    // evenly around the WHOLE circle instead of clustering
    function bestGapAngle() {
      const root = nodes[0];
      const existing = root.children.map((c) => c.dirAngle);
      let best = Math.random() * Math.PI * 2, bestScore = -Infinity;
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2;
        let minDiff = Math.PI;
        for (const e of existing) {
          let d = Math.abs(a - e) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < minDiff) minDiff = d;
        }
        if (minDiff > bestScore) { bestScore = minDiff; best = a; }
      }
      return best;
    }

    function addNode(parent, angle, dist, t, depth) {
      const child = {
        id: nextId++,
        x: parent.x + Math.cos(angle) * dist,
        y: parent.y + Math.sin(angle) * dist,
        parent,
        children: [],
        dirAngle: angle,
        depth,
        baseR: 3 + Math.random() * 2.5,
        born: t,
      };
      parent.children.push(child);
      nodes.push(child);
      return child;
    }

    function trySpawn(t) {
      if (nodes.length >= cap) return;
      const root = nodes[0];

      // 1) Keep seeding new primary spokes from the root, spread evenly
      //    around the full circle, until we hit the target count.
      if (root.children.length < spokes) {
        const angle = bestGapAngle();
        addNode(root, angle, 16 + Math.random() * 10, t, 1);
        return;
      }

      // 2) Otherwise extend an existing branch outward along roughly
      //    its own direction (small jitter), and sometimes fork into
      //    a second branch at a noticeably different local angle --
      //    this is the "random amount of new branches per branch" bit.
      const leaves = nodes.filter((n) => n.depth >= 1 && n.children.length < 2);
      if (!leaves.length) return;
      const parent = leaves[(Math.random() * leaves.length) | 0];

      const forkCount = Math.random() < 0.22 ? 2 : 1; // occasionally forks
      for (let i = 0; i < forkCount && nodes.length < cap; i++) {
        const spread = i === 0 ? 0.35 : 1.1; // second fork breaks off wider
        const angle = parent.dirAngle + (Math.random() - 0.5) * spread;
        const dist = 12 + Math.random() * 18;
        addNode(parent, angle, dist, t, parent.depth + 1);
      }
    }

    function pruneLeaf() {
      // never prune the primary spokes (depth 1) -- only trim twigs
      const leaves = nodes.filter((n) => n.depth > 1 && n.children.length === 0);
      if (!leaves.length) return;
      const v = leaves[(Math.random() * leaves.length) | 0];
      v.parent.children = v.parent.children.filter((c) => c !== v);
      nodes = nodes.filter((n) => n !== v);
    }

    function resize() {
      const box = wrapRef.current.getBoundingClientRect();
      const s = Math.min(box.width, box.height) || size;
      canvas.width = s * dpr;
      canvas.height = s * dpr;
      canvas.style.width = s + "px";
      canvas.style.height = s + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    function draw(t) {
      const s = canvas.width / dpr; // logical px size
      const cx = s / 2, cy = s / 2;
      const fitRadius = s * 0.42; // how close to the edge the network may reach

      // flat hard clear every frame -- no trail, no glow
      ctx.clearRect(0, 0, s, s);
      if (background !== "transparent") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, s, s);
      }

      const fullness = nodes.length / cap;

      // grow + prune -> a network that keeps churning forever
      if (fullness < 1) {
        if (Math.random() < 0.9) trySpawn(t);
        if (Math.random() < 0.5) trySpawn(t);
      }
      if (fullness > 0.96 || Math.random() < fullness * 0.04) pruneLeaf();

      // ---- THE KEY BEHAVIOR ----
      // Measure how far the network actually extends in world space,
      // then rescale the ENTIRE rendering so it always fits inside
      // fitRadius. As the network grows outward, this scale shrinks --
      // the whole structure visually contracts to contain itself,
      // rather than any single node shrinking on its own.
      let maxDist = 1;
      for (const n of nodes) {
        const d = Math.hypot(n.x, n.y);
        if (d > maxDist) maxDist = d;
      }
      const targetScale = Math.min(1, fitRadius / maxDist);
      scale += (targetScale - scale) * 0.07;

      // edges -- flat solid color, no gradient
      for (const n of nodes) {
        if (!n.parent) continue;
        const x1 = cx + n.parent.x * scale, y1 = cy + n.parent.y * scale;
        const x2 = cx + n.x * scale, y2 = cy + n.y * scale;
        ctx.strokeStyle = `#f5c542`;
        ctx.lineWidth = Math.max(0.5, 3 * scale);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // nodes -- flat solid fill, no glow
      for (const n of nodes) {
        const age = Math.max(0, (t - n.born) / 1000);
        const pop = Math.min(1, age / 0.4);
        const pulse = 1 + Math.sin(t / 500 + n.id) * 0.08;
        const r = Math.max(
          0.01,
          n.baseR * scale * pop * pulse * (n.parent ? 1 : 1.6)
        );
        const x = cx + n.x * scale, y = cy + n.y * scale;

        ctx.fillStyle = `#f5c542`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [cap, size, spokes, background]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: size,
        height: size,
        maxWidth: "100%",
        maxHeight: "100%",
        margin: "0 auto",
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}