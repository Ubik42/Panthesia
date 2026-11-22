/** Compile and link one program; shaders are released once linked. Throws with the driver log on failure. */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
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
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw Error(log || "Shader link failed");
    }
    return program;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

/** A unit quad as two triangles, bound to attribute 0 of the current vertex array. */
export function bindUnitQuad(gl: WebGL2RenderingContext) {
  const corners = gl.createBuffer();
  if (!corners) throw Error("Buffer allocation failed");
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return corners;
}
