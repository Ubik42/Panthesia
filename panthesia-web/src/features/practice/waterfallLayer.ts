import { rgba, type Rgba } from "./stageTheme";
import { bindUnitQuad, linkProgram } from "./webglProgram";

export type Backdrop = {
  top: string;
  middle: string;
  bottom: string;
  atmosphere: string;
  /** 0–1: how much the backdrop covers what lies behind the stage (a background image). */
  opacity: number;
};

/** Everything under the note labels: backdrop, key columns, grid lines and note bodies.
 * Calls between begin and end paint in call order. Coordinates are CSS pixels.
 */
export interface WaterfallLayer {
  readonly renderer: string;
  begin(width: number, height: number, baseline: number, dpr: number, backdrop: Backdrop): void;
  /** A filled rectangle; `dash` draws horizontal on/off segments in CSS pixels. */
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number, dash?: readonly [number, number]): void;
  /** A rounded note body with a soft right edge, a top highlight and an optional outer glow. */
  note(x: number, top: number, w: number, h: number, color: string, alpha: number, glow: number): void;
  end(): void;
  dispose(): void;
}

/** One instanced WebGL2 draw per frame. Falls back to the 2D layer when the context is missing or lost. */
export function createWaterfallLayer(
  gpuCanvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  wake: () => void,
): WaterfallLayer {
  const gpu = new WaterfallGpu(gpuCanvas, wake);
  const fallback = new Waterfall2d(ctx);
  let active: WaterfallLayer = fallback;
  return {
    get renderer() {
      return active.renderer;
    },
    begin(width, height, baseline, dpr, backdrop) {
      active = gpu.available ? gpu : fallback;
      gpuCanvas.style.visibility = active === gpu ? "visible" : "hidden";
      active.begin(width, height, baseline, dpr, backdrop);
    },
    rect: (...a) => active.rect(...a),
    note: (...a) => active.note(...a),
    end: () => active.end(),
    dispose: () => gpu.dispose(),
  };
}

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;
layout(location=2) in vec4 tint;
layout(location=3) in vec4 shape;
uniform vec2 viewport;
out vec2 local;
flat out vec4 box;
flat out vec4 color;
flat out vec4 params;
void main(){
  float pad = shape.x == 1.0 ? shape.z * 2.0 + 1.0 : 0.0;
  vec2 pixel = rect.xy - pad + corner * (rect.zw + 2.0 * pad);
  local = pixel - rect.xy;
  box = rect; color = tint; params = shape;
  gl_Position = vec4(pixel / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

// kind 0: flat or dashed rectangle; kind 1: note; kind 2: backdrop.
const fragment = `#version 300 es
precision highp float;
in vec2 local;
flat in vec4 box;
flat in vec4 color;
flat in vec4 params;
uniform float ratio;
uniform vec3 sky[3];
uniform vec4 atmosphere;
uniform float baseline;
uniform float backdropOpacity;
out vec4 fragColor;
void main(){
  vec2 size = box.zw;
  if (params.x == 2.0) {
    float t = clamp(local.y / max(1.0, size.y), 0.0, 1.0);
    vec3 c = t < 0.6 ? mix(sky[0], sky[1], t / 0.6) : mix(sky[1], sky[2], (t - 0.6) / 0.4);
    vec2 center = vec2(size.x * 0.5, baseline);
    float reach = max(size.x * 0.6, baseline);
    float a = atmosphere.a * clamp(1.0 - distance(local, center) / reach, 0.0, 1.0);
    // Premultiplied: the glow stays visible over a see-through backdrop.
    float o = max(backdropOpacity, a);
    fragColor = vec4(mix(c * backdropOpacity, atmosphere.rgb * a, a / max(o, 0.0001)), o);
    return;
  }
  if (params.x == 0.0) {
    if (params.z > 0.0 && mod(local.x, params.z + params.w) >= params.z) discard;
    fragColor = vec4(color.rgb * color.a, color.a);
    return;
  }
  float radius = params.y;
  vec2 q = abs(local - size * 0.5) - size * 0.5 + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float cover = clamp(0.5 - d * ratio, 0.0, 1.0);
  float across = local.x / max(1.0, size.x);
  float body = across < 0.45 ? 1.0 : mix(1.0, 0.69, (across - 0.45) / 0.55);
  vec3 rgb = color.rgb;
  float shine = step(1.65, local.y) * step(local.y, 2.35) * step(3.0, local.x) * step(local.x, size.x - 3.0);
  rgb = mix(rgb, vec3(1.0), shine * 0.33);
  // A dark rim keeps touching notes apart, as in Synthesia.
  float rim = clamp((d + 1.4) * ratio, 0.0, 1.0) * step(4.0, min(size.x, size.y));
  rgb = mix(rgb, rgb * 0.32, rim);
  body = mix(body, 1.0, rim);
  float glow = params.z > 0.0 ? exp(-max(d, 0.0) * max(d, 0.0) / (params.z * params.z * 0.5)) * 0.55 : 0.0;
  float a = color.a * (cover * body + (1.0 - cover) * glow);
  fragColor = vec4(rgb * a, a);
}`;

const STRIDE = 12;

class WaterfallGpu implements WaterfallLayer {
  readonly renderer = "webgl2";
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instances: WebGLBuffer | null = null;
  private corners: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private data = new Float32Array(1024 * STRIDE);
  private capacity = 0;
  private count = 0;
  private lost = false;
  private disposed = false;
  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.wake();
  };
  private onRestored = () => {
    this.lost = false;
    this.initialize();
    this.wake();
  };
  constructor(
    private canvas: HTMLCanvasElement,
    private wake: () => void,
  ) {
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.initialize();
  }
  get available() {
    return !this.disposed && !this.lost && !!this.program;
  }
  private initialize() {
    if (this.disposed) return;
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    this.gl = gl;
    if (!gl) return;
    try {
      const program = linkProgram(gl, vertex, fragment);
      this.program = program;
      this.vao = gl.createVertexArray();
      this.instances = gl.createBuffer();
      if (!this.vao || !this.instances) throw Error("Buffer allocation failed");
      gl.bindVertexArray(this.vao);
      this.corners = bindUnitQuad(gl);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      this.capacity = 0;
      for (const location of [1, 2, 3]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, STRIDE * 4, (location - 1) * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      for (const name of ["viewport", "ratio", "sky", "atmosphere", "baseline", "backdropOpacity"])
        this.uniforms[name] = gl.getUniformLocation(program, name);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } catch {
      this.release();
    }
  }
  begin(width: number, height: number, baseline: number, dpr: number, backdrop: Backdrop) {
    const gl = this.gl!;
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const bottom = rgba(backdrop.bottom);
    const opacity = Math.max(0, Math.min(1, backdrop.opacity));
    gl.clearColor(bottom[0] * opacity, bottom[1] * opacity, bottom[2] * opacity, opacity);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniform2f(u.viewport, width, height);
    gl.uniform1f(u.ratio, dpr);
    gl.uniform1f(u.baseline, baseline);
    gl.uniform1f(u.backdropOpacity, opacity);
    gl.uniform3fv(u.sky, [backdrop.top, backdrop.middle, backdrop.bottom].flatMap((c) => rgba(c).slice(0, 3)));
    gl.uniform4fv(u.atmosphere, rgba(backdrop.atmosphere));
    this.count = 0;
    this.push(0, 0, width, baseline, [0, 0, 0, 1], 1, 2, 0, 0, 0);
  }
  private push(x: number, y: number, w: number, h: number, c: Rgba, alpha: number, kind: number, radius: number, a: number, b: number) {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data,
      i = this.count++ * STRIDE;
    d[i] = x; d[i + 1] = y; d[i + 2] = w; d[i + 3] = h;
    d[i + 4] = c[0]; d[i + 5] = c[1]; d[i + 6] = c[2]; d[i + 7] = c[3] * alpha;
    d[i + 8] = kind; d[i + 9] = radius; d[i + 10] = a; d[i + 11] = b;
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number, dash?: readonly [number, number]) {
    if (w > 0 && h > 0 && alpha > 0) this.push(x, y, w, h, rgba(color), alpha, 0, 0, dash?.[0] ?? 0, dash?.[1] ?? 0);
  }
  note(x: number, top: number, w: number, h: number, color: string, alpha: number, glow: number) {
    if (w > 0 && h > 0 && alpha > 0) this.push(x, top, w, h, rgba(color), alpha, 1, Math.min(5, w / 4, h / 2), glow, 0);
  }
  end() {
    const gl = this.gl!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (this.capacity < this.data.length) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      this.capacity = this.data.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    this.canvas.dataset.instances = String(this.count);
  }
  private release() {
    const gl = this.gl;
    if (gl) {
      gl.deleteBuffer(this.instances);
      gl.deleteBuffer(this.corners);
      gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.program);
    }
    this.program = null;
    this.instances = null;
    this.corners = null;
    this.vao = null;
  }
  dispose() {
    this.disposed = true;
    this.release();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
  }
}

/** Plain 2D path for machines without WebGL2: same geometry, flat fills, no glow. */
class Waterfall2d implements WaterfallLayer {
  readonly renderer = "canvas2d";
  constructor(private ctx: CanvasRenderingContext2D) {}
  begin(width: number, _height: number, baseline: number, _dpr: number, backdrop: Backdrop) {
    const ctx = this.ctx;
    const sky = ctx.createLinearGradient(0, 0, 0, baseline);
    sky.addColorStop(0, backdrop.top);
    sky.addColorStop(0.6, backdrop.middle);
    sky.addColorStop(1, backdrop.bottom);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, backdrop.opacity));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, baseline);
    ctx.restore();
    const glow = ctx.createRadialGradient(width / 2, baseline, 0, width / 2, baseline, Math.max(width * 0.6, baseline));
    glow.addColorStop(0, backdrop.atmosphere);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, baseline);
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number, dash?: readonly [number, number]) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    if (!dash) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = h;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  note(x: number, top: number, w: number, h: number, color: string, alpha: number) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, Math.min(5, w / 4, h / 2));
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  end() {}
  dispose() {}
}
