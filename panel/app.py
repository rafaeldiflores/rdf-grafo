"""
Panel de ingesta visual del vault (Streamlit).

Corre local, nunca toca git: crea/edita archivos .md, vos revisas el diff
y comiteas cuando quieras (igual que con el CLI agregar-tecnologia).

    cd app/panel
    pip install -r requirements.txt
    streamlit run app.py
"""
from __future__ import annotations

import streamlit as st

import vault_io as v

st.set_page_config(page_title="Grafo · Panel de ingesta", page_icon="🕸️", layout="centered")
st.title("🕸️ Panel de ingesta del vault")
st.caption(f"Vault: `{v.VAULT}`")

tab_tec, tab_proy, tab_apr, tab_logro = st.tabs(["Tecnología", "Proyecto", "Aprendizaje", "Logro"])

CATEGORIAS_TEC = ["backend", "cloud", "datos", "frontend", "herramientas", "ia", "integraciones", "metodologia", "mobile", "testing"]
ESTADOS_PROYECTO = ["activo", "en_espera", "idea", "pausado", "archivado"]
ESTADOS_APRENDIZAJE = ["completado", "en_curso", "en_preparacion"]

# ---------------------------------------------------------------------------
# Tecnología
# ---------------------------------------------------------------------------
with tab_tec:
    st.subheader("Nueva tecnología o alias nuevo")
    tecnologias = v.listar_notas("tecnologia")
    proyectos = v.listar_notas("proyecto")

    existente = st.selectbox(
        "Tecnología (elige una existente para solo agregarle alias/stack, o escribe abajo el nombre de una nueva)",
        options=["— nueva —"] + [t["id"] for t in tecnologias],
    )
    if existente == "— nueva —":
        nombre_tec = st.text_input("Nombre de la tecnología nueva")
        categoria = st.selectbox("Categoría", CATEGORIAS_TEC)
    else:
        nombre_tec = existente
        categoria = None
        st.info(f'"{nombre_tec}" ya existe. Solo se le agregarán los alias y el stack que indiques abajo.')

    aliases_txt = st.text_input("Alias nuevos (separados por coma, opcional)", key="tec_alias")
    proyectos_sel = st.multiselect("Conectar al stack de estos proyectos", [p["id"] for p in proyectos], key="tec_proy")
    destacado = st.checkbox("También a stack_destacado", key="tec_destacado")

    if st.button("Guardar tecnología", type="primary"):
        if not nombre_tec.strip():
            st.error("Falta el nombre.")
        else:
            aliases = [a.strip() for a in aliases_txt.split(",") if a.strip()]
            path = v.ruta_nota("tecnologia", nombre_tec)
            if not path.exists():
                path.write_text(v.nota_tecnologia(nombre_tec, categoria or "", aliases), encoding="utf-8")
                st.success(f"Creada tecnologias/{nombre_tec}.md")
            elif aliases:
                path.write_text(v.agregar_aliases(path.read_text(encoding="utf-8"), aliases), encoding="utf-8")
                st.success(f"Alias agregados en tecnologias/{nombre_tec}.md")

            for proyecto in proyectos_sel:
                ppath = v.ruta_nota("proyecto", proyecto)
                texto = ppath.read_text(encoding="utf-8")
                link = v.wikilink(nombre_tec)
                texto, ok = v.agregar_al_array(texto, "stack", link)
                if not ok:
                    st.warning(f'proyectos/{proyecto}.md: no encontré "stack:", revísalo a mano.')
                    continue
                if destacado:
                    texto, ok2 = v.agregar_al_array(texto, "stack_destacado", link)
                ppath.write_text(texto, encoding="utf-8")
                st.success(f"Conectada a proyectos/{proyecto}.md")
            st.info('Corre `npm run build-graph` en app/ingest para validar, y comitea cuando quede bien.')

# ---------------------------------------------------------------------------
# Proyecto
# ---------------------------------------------------------------------------
with tab_proy:
    st.subheader("Proyecto nuevo")
    tecnologias = v.listar_notas("tecnologia")
    proyectos_existentes = v.listar_notas("proyecto")

    nombre_p = st.text_input("Nombre del proyecto (nombre del archivo)")
    if nombre_p and v.existe_nota("proyecto", nombre_p):
        st.error(f'Ya existe proyectos/{nombre_p}.md — esta pestaña solo crea proyectos nuevos, no reescribe uno existente.')

    col1, col2 = st.columns(2)
    with col1:
        estado_p = st.selectbox("Estado", ESTADOS_PROYECTO)
    with col2:
        visibilidad_p = st.selectbox("Visibilidad", ["publico", "privado"])

    descripcion_p = st.text_area("Descripción (cuerpo de la nota)", height=100)
    stack_sel = st.multiselect("Stack", [t["id"] for t in tecnologias])
    destacado_sel = st.multiselect("Stack destacado (subconjunto del stack de arriba)", stack_sel)
    cliente_p = st.text_input("Cliente (nombre exacto de su nota, si tiene una; se conecta como [[wikilink]])")
    relacionado_sel = st.multiselect("Relacionado con estos proyectos", [p["id"] for p in proyectos_existentes])
    repo_p = st.text_input("Repo (URL)")
    url_p = st.text_input("URL pública")

    if st.button("Crear proyecto", type="primary"):
        if not nombre_p.strip():
            st.error("Falta el nombre.")
        elif v.existe_nota("proyecto", nombre_p):
            st.error("Ya existe, no se sobrescribe.")
        else:
            contenido = v.nota_proyecto(
                nombre_p, estado_p, visibilidad_p, "", stack_sel, destacado_sel,
                cliente_p, relacionado_sel, repo_p, url_p, descripcion_p,
            )
            v.ruta_nota("proyecto", nombre_p).write_text(contenido, encoding="utf-8")
            st.success(f"Creada proyectos/{nombre_p}.md")
            st.code(contenido, language="yaml")

# ---------------------------------------------------------------------------
# Aprendizaje
# ---------------------------------------------------------------------------
with tab_apr:
    st.subheader("Aprendizaje nuevo (curso, certificación, ramo)")
    tecnologias = v.listar_notas("tecnologia")
    proyectos_a = v.listar_notas("proyecto")
    aprendizajes = v.listar_notas("aprendizaje")

    nombre_a = st.text_input("Nombre (nombre del archivo)", key="apr_nombre")
    if nombre_a and v.existe_nota("aprendizaje", nombre_a):
        st.error(f'Ya existe aprendizaje/{nombre_a}.md.')

    estado_a = st.selectbox("Estado", ESTADOS_APRENDIZAJE)
    emisor_a = st.text_input("Emisor (institución, plataforma que lo certifica)")
    plataforma_a = st.text_input("Plataforma (opcional, ej. Coursera)")
    parte_de_a = st.text_input("Parte de (nombre exacto de otra nota, opcional)")
    cubre_sel = st.multiselect("Cubre estas tecnologías", [t["id"] for t in tecnologias])
    relacionado_a_sel = st.multiselect("Relacionado con estas tecnologías", [t["id"] for t in tecnologias], key="apr_rel")
    descripcion_a = st.text_area("Descripción", height=80, key="apr_desc")

    if st.button("Crear aprendizaje", type="primary"):
        if not nombre_a.strip():
            st.error("Falta el nombre.")
        elif v.existe_nota("aprendizaje", nombre_a):
            st.error("Ya existe, no se sobrescribe.")
        else:
            contenido = v.nota_aprendizaje(
                nombre_a, estado_a, emisor_a, plataforma_a, parte_de_a,
                cubre_sel, relacionado_a_sel, descripcion_a,
            )
            v.ruta_nota("aprendizaje", nombre_a).write_text(contenido, encoding="utf-8")
            st.success(f"Creada aprendizaje/{nombre_a}.md")
            st.code(contenido, language="yaml")

# ---------------------------------------------------------------------------
# Logro (cv/BASE_Experiencia.md)
# ---------------------------------------------------------------------------
with tab_logro:
    st.subheader("Logro nuevo en la BASE")
    st.warning(
        "Reglas de la BASE: todo tiene que ser real y defendible en entrevista. "
        "Si no hay un número real, deja **métrica** vacío — nunca se inventa uno. "
        "Si el número es una estimación, anota 'ESTIMADA' en el texto (nunca se imprime en un CV)."
    )

    base_path = v.VAULT / v.RUTA_BASE
    texto_base = base_path.read_text(encoding="utf-8")
    _, _, ids_existentes = v.escanear_base(texto_base)
    secciones = v.secciones_de_proyecto(texto_base)

    seccion_sel = st.selectbox("Sección (proyecto)", [s.titulo for s in secciones])
    seccion_obj = next(s for s in secciones if s.titulo == seccion_sel)
    tema_sel = None
    if seccion_obj.temas:
        tema_sel = st.selectbox("Subsección", [t.titulo for t in seccion_obj.temas])

    id_logro = st.text_input("Id (minúsculas, guiones, sin espacios — ej. maza-nuevo-01)")
    if id_logro and id_logro.lower() in ids_existentes:
        st.error(f'El id "{id_logro}" ya existe.')
    titulo_logro = st.text_input("Título")
    tec_logro = st.text_area("tec: (tecnologías/herramientas usadas, texto libre)", height=60)
    metrica_logro = st.text_input("metrica: (vacío si no hay número real y verificado)")
    contexto_logro = st.text_area("contexto: (por qué importa, qué problema resuelve)", height=80)
    verificable_logro = st.selectbox("verificable:", ["si", "no"])

    st.divider()
    if st.button("Vista previa"):
        campos = {"tec": tec_logro, "metrica": metrica_logro, "contexto": contexto_logro, "verificable": verificable_logro}
        bloque = v.bloque_logro(id_logro or "id-pendiente", titulo_logro or "(sin título)", campos)
        st.code("\n".join(bloque), language="text")

    if st.button("Agregar logro a la BASE", type="primary"):
        if not id_logro.strip() or not titulo_logro.strip():
            st.error("Falta el id o el título.")
        else:
            campos = {"tec": tec_logro, "metrica": metrica_logro, "contexto": contexto_logro, "verificable": verificable_logro}
            texto_nuevo, error = v.insertar_logro(texto_base, seccion_sel, tema_sel, id_logro.strip().lower(), titulo_logro.strip(), campos)
            if error:
                st.error(error)
            else:
                base_path.write_text(texto_nuevo, encoding="utf-8")
                st.success(f'Logro [{id_logro}] agregado en "{seccion_sel}"' + (f' → "{tema_sel}"' if tema_sel else ""))
                st.info('Revisa el diff de cv/BASE_Experiencia.md antes de comitear — nadie más valida esto por ti.')
