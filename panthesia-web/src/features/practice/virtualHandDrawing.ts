import type { HandPose, V3 } from "./virtualHandPose";
type Point = {
    x: number;
    y: number;
};
/** Top-down cartoon skin. Original Canvas implementation; no upstream code or assets. */
export class HandDrawing {
    private ctx: CanvasRenderingContext2D;
    private size = "";
    constructor(private canvas: HTMLCanvasElement) {
        this.ctx = canvas.getContext("2d")!;
    }
    draw(poses: HandPose[], width: number, height: number, baseline: number, opacity: number) {
        const ratio = Math.min(devicePixelRatio || 1, 1.75, Math.sqrt(4_000_000 / Math.max(1, width * height)));
        const size = `${width}:${height}:${ratio}`;
        if (size !== this.size) {
            this.size = size;
            this.canvas.width = Math.ceil(width * ratio);
            this.canvas.height = Math.ceil(height * ratio);
        }
        const c = this.ctx;
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
        c.clearRect(0, 0, width, height);
        c.save();
        c.beginPath();
        c.rect(0, baseline, width, height - baseline);
        c.clip();
        c.globalAlpha = 1;
        this.canvas.style.opacity = String(opacity);
        for (const h of poses)
            this.hand(h);
        c.restore();
        this.canvas.style.visibility = poses.length ? "visible" : "hidden";
        this.canvas.dataset.handRenderer = "top-down-cartoon";
        this.canvas.dataset.handPoses = String(poses.length);
    }
    private hand(h: HandPose) {
        const c = this.ctx, u = h.unit;
        const project = (p: V3): Point => ({ x: h.wrist.x + p.x * u, y: h.baseline + (p.y - p.z * .16) * h.vertical });
        const chains = h.fingers.map(f => f.points.map(project));
        const wrist = project({ x: 0, y: h.wrist.y, z: h.wrist.z });
        const palm = new Path2D();
        const bases = chains.slice(1).map(p => p[0]).sort((a, b) => a.x - b.x);
        const a = bases[0], b = bases[3], half = u * 1.02;
        palm.moveTo(wrist.x - half, wrist.y + u * .5);
        palm.bezierCurveTo(wrist.x - half * 1.13, wrist.y - u * .9, a.x - u * .42, a.y + u * .9, a.x - u * .38, a.y + u * .08);
        palm.quadraticCurveTo((a.x + b.x) / 2, a.y - u * .35, b.x + u * .36, b.y + u * .08);
        palm.bezierCurveTo(b.x + u * .48, b.y + u * .9, wrist.x + half * 1.12, wrist.y - u * .8, wrist.x + half, wrist.y + u * .5);
        palm.closePath();
        const fingers = chains.map((pts, i) => this.finger(pts, u * [.36, .32, .34, .32, .27][i]));
        // A single outline around the complete silhouette keeps knuckles continuous.
        const fill = c.createLinearGradient(wrist.x - u * 2, 0, wrist.x + u * 2, 0);
        fill.addColorStop(0, "#edb78f");
        fill.addColorStop(.45, "#f8d2ad");
        fill.addColorStop(1, "#e8ad84");
        const paint = (path: Path2D, color: string | CanvasGradient, outline = false) => {
            c.fillStyle = color;
            c.fill(path);
            if (outline) {
                c.strokeStyle = "#a56d51";
                c.lineWidth = Math.max(1, u * .035);
                c.stroke(path);
            }
        };
        c.save();
        c.shadowColor = "rgba(21,13,10,.25)";
        c.shadowBlur = u * .3;
        c.shadowOffsetY = u * .15;
        const shadow = new Path2D(palm);
        for (const finger of fingers) shadow.addPath(finger);
        c.fillStyle = "#bf8868";
        c.fill(shadow);
        c.restore();
        // Sleeve and cuff remain behind the wrist.
        c.fillStyle = h.side === "left" ? "#348f79" : "#368797";
        c.strokeStyle = "#245b57";
        c.lineWidth = u * .045;
        c.beginPath();
        c.roundRect(wrist.x - half * 1.14, wrist.y + u * .24, half * 2.28, u * 3, [u * .2, u * .2, 0, 0]);
        c.fill();
        c.stroke();
        c.fillStyle = "#f5f0e7";
        c.beginPath();
        c.roundRect(wrist.x - half * 1.13, wrist.y + u * .12, half * 2.26, u * .45, u * .07);
        c.fill();
        c.stroke();
        // Fill one silhouette after its outline, so adjoining parts have no seams.
        const silhouette = new Path2D(palm);
        for (let i = h.thumbUnder ? 1 : 0; i < 5; i++)
            silhouette.addPath(fingers[i]);
        if (!h.thumbUnder) {
            const t = chains[0], ix = chains[1][0], web = new Path2D();
            web.moveTo(t[0].x, t[0].y + u * .3);
            web.lineTo(t[1].x, t[1].y);
            web.quadraticCurveTo((t[1].x + ix.x) / 2, (t[1].y + ix.y) / 2 + u * .6, ix.x, ix.y + u * .12);
            web.lineTo(wrist.x, wrist.y);
            web.closePath();
            silhouette.addPath(web);
        }
        else
            paint(fingers[0], fill, true);
        c.strokeStyle = "#a56d51";
        c.lineJoin = "round";
        c.lineWidth = Math.max(1.2, u * .045);
        c.stroke(silhouette);
        paint(silhouette, fill);
        for (let i = 0; i < 5; i++) {
            if (i === 0 && h.thumbUnder)
                continue;
            const pts = chains[i], tip = pts[3], near = pts[2], angle = Math.atan2(tip.y - near.y, tip.x - near.x) + Math.PI / 2;
            const r = u * [.29, .255, .27, .255, .215][i];
            c.save();
            c.translate(tip.x - Math.cos(angle - Math.PI / 2) * r * .9, tip.y - Math.sin(angle - Math.PI / 2) * r * .9);
            c.rotate(angle);
            c.fillStyle = "#fbe0ca";
            c.strokeStyle = "#c98f72";
            c.lineWidth = Math.max(.7, u * .018);
            c.beginPath();
            c.roundRect(-r * .66, -r * .4, r * 1.32, r * 1.35, [r * .6, r * .6, r * .22, r * .22]);
            c.fill();
            c.stroke();
            c.restore();
            c.strokeStyle = "rgba(154,91,60,.3)";
            c.lineWidth = Math.max(.6, u * .018);
            for (const j of [1, 2]) {
                const q = pts[j], v = pts[Math.min(3, j + 1)], n = Math.atan2(v.y - q.y, v.x - q.x);
                c.save();
                c.translate(q.x, q.y);
                c.rotate(n);
                c.beginPath();
                c.moveTo(0, -r * .53);
                c.quadraticCurveTo(-r * .16, 0, 0, r * .53);
                c.stroke();
                c.restore();
            }
        }
    }
    private finger(p: Point[], r: number) {
        const sides = [-1, 1].map(sign => p.map((v, i) => {
            const a = p[Math.max(0, i - 1)], b = p[Math.min(3, i + 1)], d = Math.max(.001, Math.hypot(b.x - a.x, b.y - a.y));
            const radius = r * [1, .96, .87, .78][i];
            return { x: v.x - (b.y - a.y) / d * radius * sign, y: v.y + (b.x - a.x) / d * radius * sign };
        }));
        const path = new Path2D(), edge = [...sides[0], ...sides[1].slice().reverse()];
        const last = edge[edge.length - 1];
        path.moveTo((last.x + edge[0].x) / 2, (last.y + edge[0].y) / 2);
        edge.forEach((v, i) => { const next = edge[(i + 1) % edge.length]; path.quadraticCurveTo(v.x, v.y, (v.x + next.x) / 2, (v.y + next.y) / 2); });
        path.closePath();
        return path;
    }
    hide() { this.canvas.style.visibility = "hidden"; this.canvas.dataset.handPoses = "0"; }
    dispose() { this.hide(); this.canvas.width = 1; this.canvas.height = 1; }
}
