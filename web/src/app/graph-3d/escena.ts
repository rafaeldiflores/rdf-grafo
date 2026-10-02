/**
 * Piezas visuales de la escena 3D que no dependen del grafo: destello de los
 * nodos, estrellas que titilan, polvo y onda de selección.
 * Todo con shaders mínimos: 52 nodos no justifican nada más pesado.
 */
import type * as THREE from 'three';

type Three = typeof THREE;

/**
 * Destello de un nodo: un plano de cara a la cámara con caída radial y mezcla
 * aditiva. El nodo se lee como un punto de luz con resplandor suave, sin
 * volumen ni reflejos.
 */
export function destello(three: Three, color: THREE.Color, radio: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new three.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        // Núcleo gaussiano más una falda ancha y tenue; se apaga antes del borde
        // del plano para que nunca se vea el cuadrado.
        float f = exp(-d * d * 7.0) * 0.42 + pow(max(0.0, 1.0 - d), 3.0) * 0.13;
        f *= 1.0 - smoothstep(0.8, 1.0, d);
        gl_FragColor = vec4(uColor * f, f * uOpacity);
      }`,
    blending: three.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const lado = radio * 5.2;
  const mesh = new three.Mesh(new three.PlaneGeometry(lado, lado), material);
  // Siempre de frente: el grafo y sus grupos no están rotados, así que basta
  // copiar la orientación de la cámara.
  mesh.onBeforeRender = (_r, _s, camera) => mesh.quaternion.copy(camera.quaternion);
  return { mesh, material };
}

/**
 * Estrellas con tamaño, tinte y fase propios. Titilan y el cielo gira lento;
 * `velocidad` < 1 lo calma (movimiento reducido) sin dejarlo muerto.
 */
export function estrellas(three: Three, color: string, velocidad: number, escala: number): THREE.Points {
  const count = 1800;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const rad = 900 + Math.random() * 1800;
    const s = Math.sqrt(1 - u * u);
    pos.set([rad * s * Math.cos(t), rad * u, rad * s * Math.sin(t)], i * 3);
    // Pocas estrellas grandes, muchas chicas: se ve natural.
    size[i] = 1.2 + Math.pow(Math.random(), 6) * 5;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new three.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new three.BufferAttribute(phase, 1));
  const material = new three.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new three.Color(color) }, uScale: { value: escala } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vAlpha = 0.35 + 0.35 * sin(uTime * 1.3 + aPhase);
        gl_PointSize = aSize * uScale * (1400.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: three.AdditiveBlending,
  });
  const points = new three.Points(geo, material);
  if (velocidad > 0) {
    points.onBeforeRender = () => {
      const t = (performance.now() / 1000) * velocidad;
      material.uniforms['uTime']!.value = t;
      // Giro lentísimo y siempre en el mismo sentido: el cielo "avanza".
      points.rotation.y = t * 0.006;
    };
  }
  return points;
}

/**
 * Onda expansiva al seleccionar: un anillo de cara a la cámara que crece y se
 * desvanece en ~0,9 s y luego se elimina solo.
 */
export function onda(three: Three, scene: THREE.Scene, camera: THREE.Camera, pos: THREE.Vector3Like, color: string, radio: number): void {
  const material = new three.MeshBasicMaterial({
    color: new three.Color(color),
    transparent: true,
    opacity: 0.9,
    blending: three.AdditiveBlending,
    depthWrite: false,
    side: three.DoubleSide,
  });
  const ring = new three.Mesh(new three.RingGeometry(radio * 0.92, radio, 64), material);
  ring.position.set(pos.x, pos.y, pos.z);
  scene.add(ring);
  const t0 = performance.now();
  ring.onBeforeRender = () => {
    const k = Math.min(1, (performance.now() - t0) / 900);
    const e = 1 - Math.pow(1 - k, 3); // ease-out cúbico
    ring.quaternion.copy(camera.quaternion);
    ring.scale.setScalar(1 + e * 5);
    material.opacity = 0.9 * (1 - k);
    if (k >= 1) {
      // Se quita en el siguiente frame: no se puede mutar la escena mientras se dibuja.
      queueMicrotask(() => {
        ring.removeFromParent();
        ring.geometry.dispose();
        material.dispose();
      });
    }
  };
}

/**
 * Polvo cósmico: partículas suaves que derivan despacio dentro del volumen del
 * grafo. La deriva es un desplazamiento senoidal en el shader (sin CPU por
 * frame); las cercanas a la cámara crecen y se ven desenfocadas, como bokeh.
 */
export function polvo(three: Three, colores: readonly string[], velocidad: number, escala: number): THREE.Points {
  const count = 700;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const c = new three.Color();
  for (let i = 0; i < count; i++) {
    // Más densidad cerca del centro, pero llenando todo el volumen visible.
    const r = 60 + Math.pow(Math.random(), 0.7) * 520;
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(t), r * u * 0.7, r * s * Math.sin(t)], i * 3);
    c.set(colores[Math.floor(Math.random() * colores.length)]!);
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = Math.random();
  }
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new three.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new three.BufferAttribute(seed, 1));
  const material = new three.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: escala } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        // Viento cósmico: todo el polvo avanza en un solo sentido (sobre todo en X,
        // con una leve subida), cada partícula a su velocidad. Al salir de la caja
        // de 1200 unidades reaparece por el lado opuesto; el fundido de abajo oculta
        // el salto.
        float largo = 1200.0;
        float avance = uTime * (5.0 + aSeed * 9.0);
        vec3 p = position;
        p.x = mod(p.x + avance + largo * 0.5, largo) - largo * 0.5;
        p.y += avance * 0.12;
        p.y = mod(p.y + largo * 0.5, largo) - largo * 0.5;
        float borde = 1.0 - smoothstep(0.38, 0.5, max(abs(p.x), abs(p.y)) / largo);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vColor = aColor;
        // Pulso lento de brillo y desvanecido de las muy cercanas (no tapan nodos).
        vAlpha = (0.4 + 0.25 * sin(uTime * 0.6 + aSeed * 60.0)) * smoothstep(20.0, 90.0, dist) * borde;
        gl_PointSize = (2.0 + aSeed * 3.4) * uScale * (620.0 / dist);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        // Núcleo suave con borde amplio: se lee como luz, no como punto duro.
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vColor, a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: three.AdditiveBlending,
  });
  const points = new three.Points(geo, material);
  points.frustumCulled = false; // el desplazamiento del shader no lo ve el culling
  if (velocidad > 0) points.onBeforeRender = () => (material.uniforms['uTime']!.value = (performance.now() / 1000) * velocidad);
  return points;
}
