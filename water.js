// Вода: свой шейдер. Глубину знает по текстуре высот острова (map.heightTexture): мелководье светлое
// и прозрачное (видно песок), глубина — насыщенно-синяя; у берега пена и бегущие к берегу полосы;
// лёгкие волны вершинами и мерцающие блики. Туман сцены учитывается.

import * as THREE from 'three';

export function createWater(size, center) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uHeight: { value: null },
    uMap: { value: 320 },
    uShallow: { value: new THREE.Color(0x6ff0e6) },
    uDeep: { value: new THREE.Color(0x1f86d6) },
    uFoam: { value: new THREE.Color(0xffffff) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, fog: true, depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        w.y += sin(w.x * 0.08 + uTime * 1.1) * 0.12 + cos(w.z * 0.07 + uTime * 0.9) * 0.1;
        vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uMap;
      uniform sampler2D uHeight;
      uniform vec3 uShallow, uDeep, uFoam;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 uv = vWorld.xz / uMap;
        float ground = -8.0;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) ground = texture2D(uHeight, uv).r * 50.0 - 10.0;
        float depth = max(0.0, vWorld.y - ground);
        float k = smoothstep(0.0, 6.0, depth);
        vec3 col = mix(uShallow, uDeep, k);
        // рябь: две бегущие шумовые волны
        float n = noise(vWorld.xz * 0.12 + uTime * 0.15) * 0.6 + noise(vWorld.xz * 0.35 - uTime * 0.25) * 0.4;
        col += (n - 0.5) * 0.08;
        // пена у берега + полосы, бегущие к берегу
        float edge = 1.0 - smoothstep(0.15, 0.9 + n * 0.5, depth);
        float bands = step(0.82, fract(depth * 1.6 - uTime * 0.35 + n * 0.6)) * (1.0 - smoothstep(0.6, 2.4, depth));
        float foam = clamp(edge + bands * 0.85, 0.0, 1.0);
        col = mix(col, uFoam, foam);
        // мерцающие блики
        float sp = step(0.985, noise(vWorld.xz * 0.9 + vec2(uTime * 0.6, -uTime * 0.4)));
        col += sp * 0.45 * (1.0 - k * 0.4);
        float alpha = mix(0.55, 0.93, k);
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 160, 160).rotateX(-Math.PI / 2), mat);
  mesh.position.set(center, 0, center);
  mesh.renderOrder = 1;
  return {
    mesh,
    setHeights(tex, mapSize) { uniforms.uHeight.value = tex; uniforms.uMap.value = mapSize; },
    update(t) { uniforms.uTime.value = t; },
  };
}
