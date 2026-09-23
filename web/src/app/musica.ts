import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Música ambiental generativa, original, al estilo multimedia de fines de los
 * 90: colchón de sintetizador cálido, bajo suave y campanitas digitales con
 * eco sobre mucha reverberación. Se sintetiza en vivo con Web Audio: no hay
 * archivos de audio ni música de terceros.
 *
 * Activada por defecto (decisión de Rafa). Los navegadores no dejan sonar audio
 * sin un gesto del visitante: se intenta al cargar y, si queda bloqueada,
 * arranca con la primera interacción en cualquier parte de la página. Si el
 * visitante la apaga, se recuerda (localStorage). Se pausa si la pestaña se oculta.
 */
@Injectable({ providedIn: 'root' })
export class MusicaService {
  /** Preferencia: encendida salvo que el visitante la haya apagado antes. */
  readonly activada = signal(leerPreferencia());
  /** Estado real: el audio está sonando (puede esperar el primer gesto). */
  readonly sonando = signal(false);
  private ctx?: AudioContext;
  private master?: GainNode;
  private bus?: GainNode; // entrada común: seco + reverb
  private eco?: GainNode; // entrada del delay de las campanitas
  private timers: ReturnType<typeof setTimeout>[] = [];
  private acorde = 0;

  constructor() {
    const onVis = () => {
      if (!this.ctx || !this.sonando()) return;
      void (document.hidden ? this.ctx.suspend() : this.ctx.resume());
    };
    document.addEventListener('visibilitychange', onVis);
    // Primer gesto en la página: si la música está activada y el navegador la
    // bloqueó al cargar, arranca aquí. El clic en el propio botón no cuenta
    // (ese clic la apaga).
    const primerGesto = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.sonido')) return;
      quitar();
      if (this.activada() && !this.sonando()) this.iniciar();
    };
    const eventos = ['pointerdown', 'keydown', 'touchend'] as const;
    const quitar = () => eventos.forEach((t) => document.removeEventListener(t, primerGesto, true));
    eventos.forEach((t) => document.addEventListener(t, primerGesto, true));

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVis);
      quitar();
      this.detener();
    });

    // Intento al cargar: suena solo si el navegador ya lo permite.
    if (this.activada()) this.intentarSinGesto();
  }

  alternar(): void {
    const on = !this.activada();
    this.activada.set(on);
    guardarPreferencia(on);
    if (on) this.iniciar();
    else this.detener();
  }

  private intentarSinGesto(): void {
    try {
      const ctx = (this.ctx ??= new AudioContext());
      // Sin gesto, resume() queda pendiente o el contexto sigue suspendido:
      // se comprueba después y, si no corre, espera al primer gesto.
      void ctx.resume();
      setTimeout(() => {
        if (ctx.state === 'running' && this.activada() && !this.sonando()) this.iniciar();
      }, 300);
    } catch {
      /* sin Web Audio: no hay música */
    }
  }

  private iniciar(): void {
    const ctx = (this.ctx ??= new AudioContext());
    // Cancela un apagado en curso (su suspend() diferido silenciaría esto).
    this.timers.forEach(clearTimeout);
    this.timers = [];
    void ctx.resume();
    if (this.sonando()) return;
    if (!this.master) this.armarCadena(ctx);
    const t = ctx.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setValueAtTime(this.master!.gain.value, t);
    this.master!.gain.linearRampToValueAtTime(0.32, t + 3); // entra con fundido
    this.sonando.set(true);
    this.acorde = 0;
    this.tocarAcorde();
    this.campanita();
  }

  private detener(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.sonando.set(false);
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 1.5);
    this.timers.push(setTimeout(() => void ctx.suspend(), 1700));
  }

  /** master ← compresor ← (seco + reverb) ← bus;  eco → delay con feedback → bus. */
  private armarCadena(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(this.master).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulso(ctx, 5, 2.6);
    const humedo = ctx.createGain();
    humedo.gain.value = 0.9;
    const seco = ctx.createGain();
    seco.gain.value = 0.45;
    this.bus = ctx.createGain();
    this.bus.connect(seco).connect(comp);
    this.bus.connect(reverb).connect(humedo).connect(comp);

    // Eco de las campanitas: delay con realimentación filtrada (cada rebote más opaco).
    this.eco = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tono = ctx.createBiquadFilter();
    tono.type = 'lowpass';
    tono.frequency.value = 2800;
    this.eco.connect(delay).connect(tono).connect(fb).connect(delay);
    tono.connect(this.bus);
    this.eco.connect(this.bus);
  }

  /** Progresión I–vi–IV–V en Re mayor, voces amplias; cada acorde dura ~9 s. */
  private tocarAcorde(): void {
    const ctx = this.ctx!;
    const acordes = [
      [50, 57, 62, 64, 66, 69], // Dadd9
      [47, 54, 59, 61, 62, 66], // Bm9
      [43, 50, 55, 59, 61, 66], // Gmaj7#11
      [45, 52, 57, 59, 62, 64], // A6sus
    ];
    const notas = acordes[this.acorde % acordes.length]!;
    const t = ctx.currentTime + 0.05;
    const dur = 9;
    for (const n of notas) this.pad(midi(n), t, dur + 3);
    this.bajo(midi(notas[0]! - 12), t, dur + 2);
    this.acorde++;
    this.timers.push(setTimeout(() => this.sonando() && this.tocarAcorde(), dur * 1000));
  }

  /** Voz de colchón: dos sierras desafinadas, filtro pasa bajos que respira, envolvente lenta. */
  private pad(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.028, t + 3);
    env.gain.setValueAtTime(0.028, t + dur - 4);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.Q.value = 0.6;
    filtro.frequency.setValueAtTime(700, t);
    filtro.frequency.linearRampToValueAtTime(1400, t + dur / 2);
    filtro.frequency.linearRampToValueAtTime(800, t + dur);
    filtro.connect(env).connect(this.bus!);
    for (const cents of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(filtro);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private bajo(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09, t + 2);
    env.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(env).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** Campanita: seno + armónico, ataque corto y cola larga, de la pentatónica de Re. */
  private campanita(): void {
    if (!this.sonando()) return;
    const ctx = this.ctx!;
    if (Math.random() < 0.72) {
      const escala = [74, 76, 78, 81, 83, 86, 88, 90];
      const f = midi(escala[Math.floor(Math.random() * escala.length)]!);
      const t = ctx.currentTime + 0.02;
      const vel = 0.025 + Math.random() * 0.03;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vel, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      env.connect(this.eco!);
      for (const [mult, tipo] of [
        [1, 'sine'],
        [2.01, 'triangle'],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = tipo;
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.value = mult === 1 ? 1 : 0.25;
        o.connect(g).connect(env);
        o.start(t);
        o.stop(t + 2.3);
      }
    }
    this.timers.push(setTimeout(() => this.campanita(), 650 + Math.random() * 1500));
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const CLAVE = 'rdf-grafo:musica';

function leerPreferencia(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== '0';
  } catch {
    return true;
  }
}

function guardarPreferencia(on: boolean): void {
  try {
    localStorage.setItem(CLAVE, on ? '1' : '0');
  } catch {
    /* sin storage: la elección dura la sesión */
  }
}

/** Respuesta al impulso sintética: ruido estéreo con caída exponencial (sala enorme). */
function impulso(ctx: AudioContext, segundos: number, caida: number): AudioBuffer {
  const largo = Math.floor(ctx.sampleRate * segundos);
  const buf = ctx.createBuffer(2, largo, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < largo; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / largo, caida);
  }
  return buf;
}
