// Дополнительная обработка кадра (только на High, только когда кадр идёт через composer):
// - мягкое затенение (AO) по буферу глубины в половинном разрешении — дома, постройки, камни получают «вес»;
// - лучи от солнца сквозь листву и блик объектива, когда солнце в кадре.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// ---------- AO ----------
// Глубина берётся из буфера, куда RenderPass только что нарисовал сцену (readBuffer.depthTexture).
// Нормали — из производных позиции; 12 выборок в диске вокруг точки (радиус в метрах), поворот диска — шум
// по пикселю; дальше 45–80 м затенение сходит на нет. Затем полноэкранный проход: цвет × размытое AO.
export class AOPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.4 }, uStrength: { value: 4.5 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDepth; uniform mat4 uProj, uProjInv; uniform vec2 uTexel; uniform float uRadius, uStrength; varying vec2 vUv;
        vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
        void main(){
          float d0 = texture2D(tDepth, vUv).x;
          if (d0 >= 0.9999) { gl_FragColor = vec4(1.0); return; }
          vec3 p = viewPos(vUv);
          vec3 n = normalize(cross(dFdx(p), dFdy(p)));
          if (dot(n, p) > 0.0) n = -n;
          float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float ang = noise * 6.2832;
          float rad = uRadius * uProj[1][1] / -p.z * 0.5;          // радиус в долях экрана
          float ao = 0.0;
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float a = ang + fi * 2.39996;                            // золотой угол
            float r = sqrt((fi + 0.5) / 12.0) * rad;
            vec2 suv = vUv + vec2(cos(a), sin(a)) * r * vec2(uProj[0][0] / uProj[1][1], 1.0);
            vec3 v = viewPos(suv) - p;
            float dist = length(v);
            ao += max(dot(n, v) / (dist + 0.001) - 0.45, 0.0) * (1.0 - smoothstep(uRadius * 0.6, uRadius * 2.0, dist));   // 0.45 — пологие стыки рельефа не затеняются, углы стен — да
          }
          ao = 1.0 - clamp(ao / 12.0 * uStrength, 0.0, 0.7);
          ao = mix(1.0, ao, 1.0 - smoothstep(45.0, 80.0, -p.z));
          gl_FragColor = vec4(ao, ao, ao, 1.0);
        }`,
    });
    this.mixMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tAO: { value: null }, uTexel: { value: new THREE.Vector2() }, uDebug: { value: 0 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDiffuse, tAO; uniform vec2 uTexel; uniform float uDebug; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float ao = 0.0;
          ao += texture2D(tAO, vUv + vec2(-1.0, -1.0) * uTexel).r; ao += texture2D(tAO, vUv + vec2(1.0, -1.0) * uTexel).r;
          ao += texture2D(tAO, vUv + vec2(-1.0, 1.0) * uTexel).r;  ao += texture2D(tAO, vUv + vec2(1.0, 1.0) * uTexel).r;
          c.rgb = mix(c.rgb * ao * 0.25, vec3(ao * 0.25), uDebug);
          gl_FragColor = c;
        }`,
    });
    this.aoQuad = new FullScreenQuad(this.aoMat);
    this.mixQuad = new FullScreenQuad(this.mixMat);
  }
  setSize(w, h) {
    this.rt.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.aoMat.uniforms.uTexel.value.set(2 / w, 2 / h);
    this.mixMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.aoMat.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.rt);
    this.aoQuad.render(renderer);
    this.mixMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mixMat.uniforms.tAO.value = this.rt.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.mixQuad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.aoMat.dispose(); this.mixMat.dispose(); this.aoQuad.dispose(); this.mixQuad.dispose(); }
}

// ---------- Лучи солнца и блик ----------
// Радиальное размытие яркого неба к солнцу: листва и стены режут лучи на полосы. Блик — несколько «призраков»
// на линии солнце → центр кадра; видимость солнца — по яркости кадра в его точке (закрыто деревом — блика нет).
export class SunRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAmt: { value: 0 }, uAspect: { value: 1 }, uTint: { value: new THREE.Color(1, 0.93, 0.78) } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAmt, uAspect; uniform vec3 uTint; varying vec2 vUv;
        float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        float ghost(vec2 at, float r) { float d = length((vUv - at) * vec2(uAspect, 1.0)); return smoothstep(r, r * 0.55, d) * 0.6 + smoothstep(r * 1.08, r, d) * smoothstep(r * 0.85, r, d) * 0.8; }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 d = (uSun - vUv) / 16.0;
          vec2 p = vUv;
          float acc = 0.0, w = 1.0;
          for (int i = 0; i < 16; i++) { p += d; acc += smoothstep(0.78, 0.97, lum(texture2D(tDiffuse, p).rgb)) * w; w *= 0.93; }
          float fall = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSun) * vec2(uAspect, 1.0)));
          vec3 col = uTint * (acc / 16.0) * fall * 0.85;
          // видимость солнца: яркость кадра вокруг его точки
          float vis = 0.0;
          vis += smoothstep(0.85, 0.98, lum(texture2D(tDiffuse, uSun).rgb));
          vis += smoothstep(0.85, 0.98, lum(texture2D(tDiffuse, uSun + vec2(0.01, 0.0)).rgb));
          vis += smoothstep(0.85, 0.98, lum(texture2D(tDiffuse, uSun - vec2(0.01, 0.0)).rgb));
          vis += smoothstep(0.85, 0.98, lum(texture2D(tDiffuse, uSun + vec2(0.0, 0.015)).rgb));
          vis *= 0.25;
          vec2 axis = vec2(0.5) - uSun;
          float fl = ghost(uSun + axis * 0.55, 0.035) * 0.5 + ghost(uSun + axis * 1.15, 0.06) * 0.35 + ghost(uSun + axis * 1.5, 0.022) * 0.6 + ghost(uSun + axis * 2.0, 0.09) * 0.25;
          col += mix(uTint, vec3(0.6, 0.8, 1.0), 0.4) * fl * vis * 0.5;
          c.rgb += col * uAmt;
          gl_FragColor = c;
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  // Положение солнца на экране; солнце не в кадре — проход выключается (ничего не стоит).
  aim(camera, sunDir, width, height) {
    const p = new THREE.Vector3().copy(camera.getWorldPosition(new THREE.Vector3())).addScaledVector(sunDir, 500).project(camera);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const facing = fwd.dot(sunDir);
    const k = THREE.MathUtils.smoothstep(facing, 0.35, 0.75) * THREE.MathUtils.smoothstep(sunDir.y, 0.02, 0.15);
    this.enabled = k > 0.01 && p.z < 1 && Math.abs(p.x) < 1.6 && Math.abs(p.y) < 1.6;
    this.mat.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.mat.uniforms.uAmt.value = k;
    this.mat.uniforms.uAspect.value = width / height;
  }
  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.mat.dispose(); this.quad.dispose(); }
}
