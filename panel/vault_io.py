"""
Acceso al vault para el panel de ingesta visual.

Mismo principio que app/ingest/src/notas.ts: edición de texto quirúrgica,
nunca reescritura completa del YAML (evita reformatear una nota entera por
agregar una línea). Lectura sí usa PyYAML sobre el bloque de frontmatter,
porque ahí solo necesitamos los valores, no preservar el archivo.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

CARPETAS_TIPO = {
    "tecnologia": "tecnologias",
    "proyecto": "proyectos",
    "aprendizaje": "aprendizaje",
}

RUTA_BASE = "cv/BASE_Experiencia.md"


def resolver_vault() -> Path:
    """Mismo orden de prioridad que app/ingest/src/config.ts: VAULT_PATH o ../../vault."""
    env = os.environ.get("VAULT_PATH")
    ruta = Path(env) if env else Path(__file__).resolve().parent.parent.parent / "vault"
    if not ruta.exists():
        raise RuntimeError(f'No existe el vault en "{ruta}". Define VAULT_PATH.')
    return ruta


VAULT = resolver_vault()


def leer_frontmatter(path: Path) -> tuple[dict, str]:
    """Devuelve (frontmatter como dict, texto completo). No falla si el YAML es raro: devuelve {}."""
    texto = path.read_text(encoding="utf-8")
    if not texto.startswith("---"):
        return {}, texto
    fin = texto.find("\n---", 3)
    if fin == -1:
        return {}, texto
    bloque = texto[3:fin].strip("\n")
    try:
        data = yaml.safe_load(bloque) or {}
    except yaml.YAMLError:
        data = {}
    return data if isinstance(data, dict) else {}, texto


def listar_notas(tipo: str) -> list[dict]:
    """Notas de un tipo ('tecnologia', 'proyecto', 'aprendizaje'), con su id (nombre de archivo)."""
    carpeta = VAULT / CARPETAS_TIPO[tipo]
    if not carpeta.exists():
        return []
    out = []
    for f in sorted(carpeta.glob("*.md")):
        data, _ = leer_frontmatter(f)
        if data.get("tipo") != tipo:
            continue
        out.append({"id": f.stem, **data})
    return sorted(out, key=lambda n: n["id"].lower())


def existe_nota(tipo: str, nombre: str) -> bool:
    return (VAULT / CARPETAS_TIPO[tipo] / f"{nombre}.md").exists()


def ruta_nota(tipo: str, nombre: str) -> Path:
    return VAULT / CARPETAS_TIPO[tipo] / f"{nombre}.md"


def wikilink(nombre: str) -> str:
    return f'"[[{nombre}]]"'


# ---------------------------------------------------------------------------
# Edición quirúrgica de arrays y aliases (puerto de app/ingest/src/notas.ts)
# ---------------------------------------------------------------------------

def agregar_al_array(texto: str, campo: str, link: str) -> tuple[str, bool]:
    """Agrega `link` a un array inline `campo: [...]` si no está ya. (texto, ok)."""
    patron = re.compile(rf"^{re.escape(campo)}:\s*\[(.*)\]\s*$", re.M)
    m = patron.search(texto)
    if not m:
        return texto, False
    existentes = [s.strip() for s in m.group(1).split(",") if s.strip()]
    if link in existentes:
        return texto, True
    nuevo = f"{m.group(1)}, {link}" if m.group(1).strip() else link
    return texto[: m.start()] + f"{campo}: [{nuevo}]" + texto[m.end() :], True


def agregar_aliases(texto: str, nuevos: list[str]) -> str:
    if not nuevos:
        return texto
    patron = re.compile(r"^aliases:\s*\[(.*)\]\s*$", re.M)
    m = patron.search(texto)
    if m:
        existentes = [s.strip() for s in m.group(1).split(",") if s.strip()]
        todos = list(dict.fromkeys(existentes + nuevos))  # dedup preservando orden
        return texto[: m.start()] + f"aliases: [{', '.join(todos)}]" + texto[m.end() :]
    nivel = re.search(r"^nivel:.*$", texto, re.M)
    if not nivel:
        return texto
    return texto[: nivel.end()] + f"\naliases: [{', '.join(nuevos)}]" + texto[nivel.end() :]


def nota_tecnologia(nombre: str, categoria: str, aliases: list[str]) -> str:
    linea_alias = f"\naliases: [{', '.join(aliases)}]" if aliases else ""
    return f"---\ntipo: tecnologia\ncategoria: {categoria}\nnivel:{linea_alias}\n---\n# {nombre}\n"


def nota_aprendizaje(nombre: str, estado: str, emisor: str, plataforma: str, parte_de: str,
                      cubre: list[str], relacionado: list[str], descripcion: str) -> str:
    cubre_str = ", ".join(wikilink(x) for x in cubre)
    relacionado_str = ", ".join(wikilink(x) for x in relacionado)
    parte_de_str = wikilink(parte_de) if parte_de else ""
    return (
        "---\n"
        "tipo: aprendizaje\n"
        f"estado: {estado}\n"
        "visibilidad: publico\n"
        f"emisor: {emisor}\n"
        f"plataforma: {plataforma}\n"
        f"parte_de: {parte_de_str}\n"
        f"cubre: [{cubre_str}]\n"
        f"relacionado: [{relacionado_str}]\n"
        "---\n"
        f"# {nombre}\n"
        f"{descripcion}\n"
    )


def nota_proyecto(nombre: str, estado: str, visibilidad: str, parte_de: str, stack: list[str],
                   stack_destacado: list[str], cliente: str, relacionado: list[str], repo: str,
                   url: str, descripcion: str) -> str:
    stack_str = ", ".join(wikilink(x) for x in stack)
    destacado_str = ", ".join(wikilink(x) for x in stack_destacado)
    relacionado_str = ", ".join(wikilink(x) for x in relacionado)
    parte_de_str = wikilink(parte_de) if parte_de else ""
    cliente_str = wikilink(cliente) if cliente else ""
    return (
        "---\n"
        "tipo: proyecto\n"
        f"estado: {estado}\n"
        f"visibilidad: {visibilidad}\n"
        f"parte_de: {parte_de_str}\n"
        f"stack: [{stack_str}]\n"
        f"stack_destacado: [{destacado_str}]\n"
        f"cliente: {cliente_str}\n"
        f"relacionado: [{relacionado_str}]\n"
        f"repo: {repo}\n"
        f"url: {url}\n"
        "---\n"
        f"# {nombre}\n"
        f"{descripcion}\n"
        "\n## Bitácora\n"
    )


# ---------------------------------------------------------------------------
# BASE_Experiencia.md: lectura de secciones/temas/ids y armado del bloque de un logro
# (mismas reglas que app/ingest/src/logros.ts, para no desincronizarse)
# ---------------------------------------------------------------------------

SECCION_RE = re.compile(r"^##\s+(.+?)\s*$")
TEMA_RE = re.compile(r"^###\s+(.+?)\s*$")
LOGRO_RE = re.compile(r"^-\s+\[([a-z0-9][a-z0-9-]*)\]\s+(.+?)\s*$", re.I)


@dataclass
class Tema:
    titulo: str
    inicio: int
    fin: int


@dataclass
class Seccion:
    titulo: str
    inicio: int
    fin: int
    temas: list[Tema]


def escanear_base(texto: str) -> tuple[list[str], list[Seccion], set[str]]:
    lineas = texto.split("\n")
    secciones: list[Seccion] = []
    ids: set[str] = set()
    actual: Seccion | None = None
    tema_actual: Tema | None = None
    for i, linea in enumerate(lineas):
        m = SECCION_RE.match(linea)
        if m:
            if actual is not None:
                actual.fin = i
                if tema_actual is not None:
                    tema_actual.fin = i
            actual = Seccion(titulo=m.group(1), inicio=i, fin=len(lineas), temas=[])
            secciones.append(actual)
            tema_actual = None
            continue
        m = TEMA_RE.match(linea)
        if m and actual is not None:
            if tema_actual is not None:
                tema_actual.fin = i
            tema_actual = Tema(titulo=m.group(1), inicio=i, fin=actual.fin)
            actual.temas.append(tema_actual)
            continue
        m = LOGRO_RE.match(linea)
        if m:
            ids.add(m.group(1).lower())
    return lineas, secciones, ids


def secciones_de_proyecto(texto: str) -> list[Seccion]:
    """Solo las secciones `##` que ya tienen al menos un logro: descarta preámbulos
    como REGLAS DE USO, IDENTIDAD, STACK TECNICO CONSOLIDADO, EDUCACION, OTROS."""
    lineas, secciones, _ = escanear_base(texto)
    return [s for s in secciones if any(LOGRO_RE.match(l) for l in lineas[s.inicio : s.fin])]


def bloque_logro(id_: str, titulo: str, campos: dict[str, str]) -> list[str]:
    out = [f"- [{id_}] {titulo}"]
    for clave, valor in campos.items():
        if valor and valor.strip():
            out.append(f"  {clave}: {valor.strip()}")
    return out


def insertar_logro(texto: str, seccion_titulo: str, tema_titulo: str | None,
                    id_: str, titulo: str, campos: dict[str, str]) -> tuple[str, str | None]:
    """Inserta el logro al final de la sección (o del tema, si se indica).
    Devuelve (texto_nuevo, error). Si hay error, texto_nuevo es el original."""
    lineas, secciones, ids = escanear_base(texto)
    if id_.lower() in ids:
        return texto, f'El id "{id_}" ya existe en la BASE.'
    seccion = next((s for s in secciones if s.titulo == seccion_titulo), None)
    if seccion is None:
        return texto, f'No encontré la sección "{seccion_titulo}".'
    if seccion.temas:
        tema = next((t for t in seccion.temas if t.titulo == tema_titulo), None)
        if tema is None:
            return texto, "Esta sección tiene subsecciones (###): elige una."
        rango_inicio, rango_fin = tema.inicio, tema.fin
    else:
        rango_inicio, rango_fin = seccion.inicio, seccion.fin

    ultimo_no_vacio = rango_inicio
    for i in range(rango_inicio, rango_fin):
        if lineas[i].strip():
            ultimo_no_vacio = i
    punto_insercion = ultimo_no_vacio + 1

    nuevas = [""] + bloque_logro(id_, titulo, campos)
    resultado = lineas[:punto_insercion] + nuevas + lineas[punto_insercion:]
    texto_nuevo = "\n".join(resultado)

    # Verificación: releer el resultado y confirmar que sumó exactamente un id nuevo.
    _, _, ids_despues = escanear_base(texto_nuevo)
    if len(ids_despues) != len(ids) + 1 or id_.lower() not in ids_despues:
        return texto, "La verificación post-inserción falló: no se escribió el archivo. Revísalo a mano."
    return texto_nuevo, None
