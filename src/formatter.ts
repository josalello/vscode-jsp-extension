import prettier from "prettier";

type Options = {
  tabWidth: number;
  useTabs: boolean;
  javaFormat: "auto" | "indent-only" | "off";
};

type Segment =
  | { kind: "html"; text: string }
  | { kind: "jsp-scriptlet"; raw: string; inner: string } // <% ... %>
  | { kind: "jsp-expr"; raw: string; inner: string }      // <%= ... %>
  | { kind: "jsp-decl"; raw: string; inner: string }      // <%! ... %>
  | { kind: "jsp-directive"; raw: string; inner: string }; // <%@ ... %>

/** Captura cualquier bloque JSP, incluidas directivas/expresiones/declaraciones/scriptlets. */
const JSP_BLOCK_RE = /(<%[\s\S]*?%>)/g;

/** Detección robusta del tipo de bloque permitiendo espacios/saltos tras '<%'. */
function splitIntoSegments(input: string): Segment[] {
  const parts = input.split(JSP_BLOCK_RE);
  const segments: Segment[] = [];

  for (const part of parts) {
    if (part.startsWith("<%") && part.endsWith("%>")) {
      // cuerpo “tal cual”, sin <%, %>
      const rawBody = part.slice(2, -2);
      const trimmed = rawBody.trim();

      // Detectar tipo tolerando espacios y saltos: <%  @, <%  =, <%  !
      const isDirective = /^<%\s*@/.test(part);
      const isExpr = /^<%\s*=/.test(part);
      const isDecl = /^<%\s*!/.test(part);

      if (isDirective) {
        // quita '@' inicial y espacios
        const inner = trimmed.replace(/^@+/, "").trim();
        segments.push({ kind: "jsp-directive", raw: part, inner });
      } else if (isExpr) {
        // quita '=' y espacios
        const inner = rawBody.replace(/^[\s=]+/, "").replace(/\s+$/, "");
        segments.push({ kind: "jsp-expr", raw: part, inner });
      } else if (isDecl) {
        const inner = rawBody.replace(/^[\s!]+/, "").trim();
        segments.push({ kind: "jsp-decl", raw: part, inner });
      } else {
        // scriptlet normal
        segments.push({ kind: "jsp-scriptlet", raw: part, inner: trimmed });
      }
    } else if (part.length) {
      segments.push({ kind: "html", text: part });
    }
  }
  return segments;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => {
      const t = l.trimEnd();
      return t.length ? pad + t : "";
    })
    .join("\n");
}

/** Normaliza directivas: quita @, detecta nombre, ordena attrs y recompone como <%@ name k="v" ... %>. */
function normalizeDirective(inner: string): string {
  const s = inner.replace(/^@+/, "").trim();

  // 1) nombre de directiva
  const m = s.match(/^(\w+)\s*/);
  if (!m) return s; // si no hay nombre, devolvemos tal cual
  const name = m[1];
  const rest = s.slice(m[0].length);

  // 2) pares k="v" o k=v (sin comillas)
  const pairs: Array<{ k: string; v: string }> = [];
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s"'>]+))/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(rest)) !== null) {
    pairs.push({ k: a[1], v: a[2] ?? a[3] ?? "" });
  }

  // Si hay comillas desparejadas o nada parsable, devolvemos s sin tocar (evitamos “arreglar” roto).
  if (!pairs.length && /["']/.test(rest)) return s;

  // 3) ordenamos por clave para consistencia
  pairs.sort((p, q) => p.k.localeCompare(q.k));

  // 4) recompone en forma estándar k="v"
  const attrs = pairs.map(({ k, v }) => `${k}="${v}"`).join(" ");
  return attrs ? `${name} ${attrs}` : name;
}

/** Extrae de forma robusta el cuerpo entre llaves de un método dado. */
function extractMethodBody(formatted: string, methodSignature: string): string | null {
  const sigIdx = formatted.indexOf(methodSignature);
  if (sigIdx === -1) return null;

  let i = formatted.indexOf("{", sigIdx);
  if (i === -1) return null;

  i++; // empezar dentro del bloque
  let depth = 1;
  const start = i;

  for (; i < formatted.length; i++) {
    const ch = formatted[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const body = formatted.slice(start, i);
        return body.trim();
      }
    }
  }
  return null;
}

/**
 * Intenta formatear un fragmento Java usando prettier-plugin-java.
 * - scriptlet: se envuelve en un método ficticio.
 * - decl: se envuelve en una clase ficticia.
 * - expr: se devuelve "tal cual" (solo trim), porque es una expresión (<%= ... %>).
 * Devuelve null si no se pudo (plugin no empaquetado o error de parseo).
 */
async function tryFormatJavaFragment(
  code: string,
  mode: "scriptlet" | "decl" | "expr",
  tabWidth: number,
  useTabs: boolean
): Promise<string | null> {
  try {
    // Carga dinámica compatible ESM/CJS del plugin (empaquetado vía bundledDependencies)
    const mod: any = await import("prettier-plugin-java");
    const plugin = mod?.default ?? mod;
    console.log("[JSP Formatter] prettier-plugin-java OK");

    if (mode === "expr") {
      return code.trim();
    }

    const wrapped =
      mode === "decl"
        ? `class __J { ${code} }`
        : `class __J { void __m() { ${code} } }`;

    const formatted = await prettier.format(wrapped, {
      parser: "java",
      plugins: [plugin],
      tabWidth,
      useTabs
      // printWidth: 100, // activa si quieres forzar más cortes de línea
    });

    if (mode === "decl") {
      // Extrae el interior de la clase ficticia
      const open = formatted.indexOf("{");
      const close = formatted.lastIndexOf("}");
      if (open !== -1 && close !== -1 && close > open) {
        const inner = formatted.slice(open + 1, close).trim();
        return inner;
      }
      return code.trim();
    } else {
      // scriptlet → extrae el cuerpo del método ficticio (robusto a espacios y saltos)
      const body = extractMethodBody(formatted, "void __m()");
      return body ?? code.trim();
    }
  } catch (e) {
    console.warn(
      "[JSP Formatter] NO se pudo cargar/usar prettier-plugin-java (fallback indent-only).",
      e
    );
    return null;
  }
}

/** Devuelve la indentación (espacios/tabs) de la línea donde está 'idx' en 'text' y si hay texto antes. */
function getLineIndentInfo(text: string, idx: number) {
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  const before = text.slice(lineStart, idx);
  const onlyWhitespaceBefore = /^[\t ]*$/.test(before);
  const baseIndent = (before.match(/^[\t ]*/)?.[0]) ?? "";
  return { baseIndent, onlyWhitespaceBefore, lineStart };
}

/** Inserta el reemplazo aplicando indentación base y separando bloques consecutivos %><% con un salto. */
function replaceTokenWithIndent(
  whole: string,
  token: string,
  replacementRaw: string,
  kind: Segment["kind"]
): string {
  const idx = whole.indexOf(token);
  if (idx === -1) return whole;

  const { baseIndent, onlyWhitespaceBefore } = getLineIndentInfo(whole, idx);

  // ¿Viene justo pegado a otro bloque JSP (%><%)? Si sí, añadimos salto antes del nuevo bloque.
  const left2 = whole.slice(Math.max(0, idx - 2), idx);
  const needsLeadingNewline = left2.endsWith("%>");

  let replacement = replacementRaw;

  if (kind === "jsp-expr") {
    // Si es inline (hay texto antes en la línea), no forzamos indent ni saltos
    if (onlyWhitespaceBefore) {
      replacement = baseIndent + replacement;
    }
  } else {
    // Bloques (scriptlet / decl / directiva):
    // 1) si viene pegado a un %> anterior, forzamos un salto (y luego indentar)
    if (needsLeadingNewline && !replacement.startsWith("\n")) {
      replacement = "\n" + replacement;
    }
    // 2) aplicar indentación base a TODAS las líneas del bloque
    replacement = replacement
      .split("\n")
      .map((l) => (l.length ? baseIndent + l : l))
      .join("\n");
  }

  return whole.slice(0, idx) + replacement + whole.slice(idx + token.length);
}

/**
 * Formatea un documento JSP:
 * - Sustituye bloques JSP por placeholders de comentario HTML para preservar posiciones.
 * - Pasa el HTML por Prettier (parser "html").
 * - Restaura cada placeholder insertando el bloque JSP formateado según tipo y config,
 *   aplicando la indentación base del HTML y separando bloques consecutivos.
 */
export async function formatJspDocument(input: string, opts: Options): Promise<string> {
  const segments = splitIntoSegments(input);

  // 1) Construimos el buffer HTML con placeholders robustos para Prettier
  //    Usamos comentarios HTML para asegurar que no se reordenen ni colapsen.
  const placeholderOf = (i: number) => `<!--__JSP_PLACEHOLDER_${i}__-->`;

  const placeholderMap: { indexInSegments: number }[] = [];
  let htmlBuffer = "";

  segments.forEach((seg, i) => {
    if (seg.kind === "html") {
      htmlBuffer += seg.text;
    } else {
      const pIndex = placeholderMap.length;
      placeholderMap.push({ indexInSegments: i });
      htmlBuffer += placeholderOf(pIndex);
    }
  });

  // 2) Formateamos el HTML con Prettier
  let formattedHtml = htmlBuffer;
  try {
    formattedHtml = await prettier.format(htmlBuffer, {
      parser: "html",
      tabWidth: opts.tabWidth,
      useTabs: opts.useTabs
    });
  } catch (e) {
    console.warn("[JSP Formatter] Error formateando HTML con Prettier, devolviendo tal cual.", e);
    formattedHtml = htmlBuffer;
  }

  // 3) Reemplazamos cada placeholder por el bloque JSP formateado + indentado con el margen del HTML
  let out = formattedHtml;

  for (let p = 0; p < placeholderMap.length; p++) {
    const seg = segments[placeholderMap[p].indexInSegments];
    if (!seg || seg.kind === "html") continue;

    let replacement = seg.raw;

    if (seg.kind === "jsp-directive") {
      const body = normalizeDirective(seg.inner);
      replacement = `<%@ ${body} %>`;
    } else if (seg.kind === "jsp-expr") {
      // Mantener conciso: <%= expr %>
      replacement = `<%= ${seg.inner.trim()} %>`;
    } else if (seg.kind === "jsp-decl") {
      if (opts.javaFormat === "off") {
        replacement = `<%! ${seg.inner} %>`;
      } else if (opts.javaFormat === "indent-only") {
        replacement = `<%!\n${indent(seg.inner, opts.tabWidth)}\n%>`;
      } else {
        const java = await tryFormatJavaFragment(
          seg.inner,
          "decl",
          opts.tabWidth,
          opts.useTabs
        );
        replacement = java
          ? `<%!\n${java}\n%>`
          : `<%!\n${indent(seg.inner, opts.tabWidth)}\n%>`;
      }
    } else if (seg.kind === "jsp-scriptlet") {
      if (opts.javaFormat === "off") {
        replacement = `<% ${seg.inner} %>`;
      } else if (opts.javaFormat === "indent-only") {
        replacement = `<%\n${indent(seg.inner, opts.tabWidth)}\n%>`;
      } else {
        const java = await tryFormatJavaFragment(
          seg.inner,
          "scriptlet",
          opts.tabWidth,
          opts.useTabs
        );
        replacement = java
          ? `<%\n${java}\n%>`
          : `<%\n${indent(seg.inner, opts.tabWidth)}\n%>`;
      }
    }

    // Reemplazo con indentación base + salto entre bloques si procede
    out = replaceTokenWithIndent(out, placeholderOf(p), replacement, seg.kind);
  }

  return out;
}
