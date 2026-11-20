import { strikeVertex, strikeFragment } from "./midiVisualizerShaders";

const CAPACITY = 2048,
  STRIDE = 10;
/** One instanced batch for transient halos, beams, rings and particles.
 * The owner supplies time/geometry and drives frames; this renderer has no clock.
 */
export class MidiVisualizerGpu {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instances: WebGLBuffer | null = null;
  private corners: WebGLBuffer | null = null;
  private viewport: WebGLUniformLocation | null = null;
  private data = new Float32Array(CAPACITY * STRIDE);
  private count = 0;
  private lost = false;
  private disposed = false;
  private colors = new Map<string, readonly number[]>();
  private lostContext = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.canvas.style.visibility = "hidden";
    this.wake();
  };
  private restoredContext = () => {
    this.lost = false;
    this.initialize();
    this.wake();
  };
  constructor(
    private canvas: HTMLCanvasElement,
    private wake: () => void,
  ) {
    canvas.addEventListener("webglcontextlost", this.lostContext);
    canvas.addEventListener("webglcontextrestored", this.restoredContext);
    this.initialize();
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
    if (!gl) {
      this.canvas.dataset.effectRenderer = "canvas2d-fallback";
      return;
    }
    const shaders: WebGLShader[] = [];
    try {
      const compile = (kind: number, source: string) => {
        const shader = gl.createShader(kind);
        if (!shader) throw Error("Shader allocation failed");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
        return shader;
      };
      const program = gl.createProgram();
      if (!program) throw Error("Program allocation failed");
      this.program = program;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, strikeVertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, strikeFragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program) || "Shader link failed");
      this.vao = gl.createVertexArray();
      this.instances = gl.createBuffer();
      this.corners = gl.createBuffer();
      if (!this.vao || !this.instances || !this.corners)
        throw Error("Buffer allocation failed");
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      for (const [location, size, offset] of [
        [1, 4, 0],
        [2, 4, 4],
        [3, 2, 8],
      ]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          size,
          gl.FLOAT,
          false,
          STRIDE * 4,
          offset * 4,
        );
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      this.viewport = gl.getUniformLocation(program, "viewport");
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.canvas.dataset.effectRenderer = "midivisualizer-webgl2";
    } catch {
      this.release();
      this.canvas.dataset.effectRenderer = "canvas2d-fallback";
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  get available() {
    return !this.disposed && !this.lost && !!this.program;
  }
  begin(width: number, height: number, baseline: number, ratio: number) {
    this.count = 0;
    if (!this.available) return false;
    const gl = this.gl!;
    // Bound framebuffer work on 4K/high-DPI windows; CSS geometry stays unchanged.
    const dpr = Math.min(
      2,
      ratio,
      Math.sqrt(4_000_000 / Math.max(1, width * height)),
    );
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.visibility = "visible";
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      0,
      Math.max(0, Math.ceil((height - baseline) * dpr)),
      w,
      Math.max(0, Math.floor(baseline * dpr)),
    );
    gl.useProgram(this.program);
    gl.uniform2f(this.viewport, width, height);
    return true;
  }
  sprite(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    alpha: number,
    kind: number,
    phase = 0,
  ) {
    if (this.count === CAPACITY || alpha <= 0 || w <= 0 || h <= 0) return;
    let rgb = this.colors.get(color);
    if (!rgb) {
      const hex = /^#[0-9a-f]{6}$/i.test(color)
        ? parseInt(color.slice(1), 16)
        : 0x66edce;
      rgb = [(hex >>> 16) / 255, ((hex >>> 8) & 255) / 255, (hex & 255) / 255];
      if (this.colors.size >= 64) this.colors.clear();
      this.colors.set(color, rgb);
    }
    const i = this.count++ * STRIDE;
    this.data[i] = x;
    this.data[i + 1] = y;
    this.data[i + 2] = w;
    this.data[i + 3] = h;
    this.data[i + 4] = rgb[0];
    this.data[i + 5] = rgb[1];
    this.data[i + 6] = rgb[2];
    this.data[i + 7] = alpha;
    this.data[i + 8] = kind;
    this.data[i + 9] = phase;
  }
  end() {
    if (!this.available) return;
    const gl = this.gl!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (this.count) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * STRIDE);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    this.canvas.dataset.effectInstances = String(this.count);
    this.canvas.dataset.effectDrawCalls = this.count ? "1" : "0";
  }
  clear() {
    this.count = 0;
    this.canvas.style.visibility = "hidden";
    this.canvas.dataset.effectInstances = "0";
    this.canvas.dataset.effectDrawCalls = "0";
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
    this.clear();
    this.release();
    this.colors.clear();
    this.canvas.removeEventListener("webglcontextlost", this.lostContext);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.restoredContext,
    );
  }
}
