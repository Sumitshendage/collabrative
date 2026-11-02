// Full-page motion background: a flowing aurora drawn by one fragment shader.
// Raw WebGL (no three.js) so it costs a single draw call and a few KB, and it
// pauses when the tab is hidden or the visitor prefers reduced motion.
import { useEffect, useRef } from 'react'

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

// Domain-warped value noise, coloured in the site's coral / violet / cyan.
// The pointer bends the flow and adds a soft light where it hovers.
const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float time;
uniform vec2 mouse;
uniform float intensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / res.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * res.xy) / res.y;
  float t = time * 0.06;

  vec2 m = (mouse - 0.5) * vec2(res.x / res.y, 1.0);
  float md = length(p - m);
  p += (p - m) * 0.08 * exp(-md * 3.0);

  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.8 + 2.0 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p * 1.8 + 2.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.6 + 2.2 * r);

  vec3 ink = vec3(0.039, 0.043, 0.051);
  vec3 coral = vec3(1.0, 0.42, 0.29);
  vec3 violet = vec3(0.55, 0.36, 1.0);
  vec3 cyan = vec3(0.31, 0.82, 1.0);

  vec3 col = mix(coral, violet, clamp(q.x * 1.6, 0.0, 1.0));
  col = mix(col, cyan, clamp(r.y * r.y * 1.8, 0.0, 1.0));
  float band = smoothstep(0.35, 0.95, f) * (0.55 + 0.45 * sin(uv.x * 3.0 + time * 0.2));
  col = mix(ink, col, band * 0.55 * intensity);

  col += vec3(1.0, 0.55, 0.45) * 0.07 * intensity * exp(-md * 2.4);
  col *= 1.0 - 0.55 * length(uv - 0.5); // vignette
  gl_FragColor = vec4(col, 1.0);
}`

export function Background({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false })
    if (!gl) return // the CSS gradient underneath stays as the fallback

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'res')
    const uTime = gl.getUniformLocation(prog, 'time')
    const uMouse = gl.getUniformLocation(prog, 'mouse')
    gl.uniform1f(gl.getUniformLocation(prog, 'intensity'), intensity)

    // Rendered at reduced resolution: the image is soft anyway, and it keeps the GPU cool.
    const scale = 0.5
    const resize = () => {
      canvas.width = Math.ceil(innerWidth * scale)
      canvas.height = Math.ceil(innerHeight * scale)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
    }
    resize()
    addEventListener('resize', resize)

    const target = { x: 0.6, y: 0.6 }
    const mouse = { x: 0.6, y: 0.6 }
    const onMove = (e: PointerEvent) => ((target.x = e.clientX / innerWidth), (target.y = 1 - e.clientY / innerHeight))
    addEventListener('pointermove', onMove)

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now() - 20_000
    let raf = 0
    const frame = (now: number) => {
      mouse.x += (target.x - mouse.x) * 0.04
      mouse.y += (target.y - mouse.y) * 0.04
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform2f(uMouse, mouse.x, mouse.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reduced && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVisibility)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [intensity])

  return <canvas ref={ref} className="bg-aurora" aria-hidden />
}
