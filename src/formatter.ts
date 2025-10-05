import prettier from "prettier";

type Options = {
  tabWidth: number;
  useTabs: boolean;
  javaFormat: "auto" | "indent-only" | "off";
  blockIndent: number; // espacios extra para el contenido entre <% ... %>
};

type Segment =
  | { kind: "html"; text: string }
  | { kind: "jsp-scriptlet"; raw: string; inner: string } // <% ... %>
  | { kind: "jsp-expr"; raw: string; inner: string } // <%= ... %>
  | { kind: "jsp-decl"; raw: string; inner: string } // <%! ... %>
  | { kind: "jsp-directive"; raw: string; inner: string }; // <%@ ... %>

const JSP_BLOCK_RE = /(<%[\s\S]*?%>)/g;

/* ------------------------------------------------------------------ */
/* Utilidades generales                                               */
/* ------------------------------------------------------------------ */

function stripCommonIndent(text: string): string {
  const lines = text.split("\n");
  const first = lines[0].trim().length === 0 ? 1 : 0;
  const last =
    lines.length - 1 - (lines[lines.length - 1].trim().length === 0 ? 1 : 0);
  const slice = lines.slice(first, last + 1);

  let min = Infinity;
  for (const l of slice) {
    if (!l.trim()) continue;
    const m = l.match(/^[ \t]*/)?.[0].length ?? 0;
    if (m < min) min = m;
  }
  if (min === Infinity || min === 0) return lines.join("\n");

  const dedented = lines.map((l, i) => {
    if (i < first || i > last) return l;
    if (!l.trim()) return "";
    return l.slice(min);
  });
  return dedented.join("\n");
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

/* ------------------------------------------------------------------ */
/* Fallback Java "bonito pro" (cuando el plugin no está disponible)   */
/* ------------------------------------------------------------------ */

/** Divide por ';' ignorando comillas y el ; de for(;;) */
function splitStatementsRespectingQuotes(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaping = false;
  let parenDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaping) {
      buf += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escaping = true;
      continue;
    }
    if (!inSingle && ch === '"') inDouble = !inDouble;
    else if (!inDouble && ch === "'") inSingle = !inSingle;

    if (!inSingle && !inDouble) {
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    }

    buf += ch;

    if (!inSingle && !inDouble && parenDepth === 0 && ch === ";") {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length) out.push(buf.trim());
  return out;
}

function looksLikeCaseLabel(s: string): boolean {
  return /^case\b[\s\S]*:\s*$/.test(s) || /^default:\s*$/.test(s);
}

function startsWithAny(s: string, kws: string[]): boolean {
  return kws.some((k) => new RegExp("^" + k + "\\b").test(s));
}

/**
 * Formatea Java sin plugin:
 * - reflow de múltiples sentencias por línea
 * - bloques por llaves
 * - switch/case y default con indent de cuerpo
 * - if/else if/else, for/while/do, try/catch/finally
 */
function formatJavaPrettyFallback(code: string, tabWidth: number): string {
  // Normalizaciones seguras (no cambian semántica):
  // agrupa "}\nelse" → "} else" y "}\ncatch"/"finally"
  code = code.replace(/}\s+(else if|else|catch|finally)\b/g, "} $1");

  const lines = code.split("\n");
  let level = 0;
  const out: string[] = [];

  // Pila para saber en qué niveles hay un 'switch' abierto
  const switchLevels: number[] = [];

  const pushLine = (lvl: number, text: string) => {
    const pad = " ".repeat(Math.max(0, lvl) * tabWidth);
    out.push(pad + text.trim());
  };

  for (let raw of lines) {
    let line = raw.trim();
    if (!line.length) {
      out.push("");
      continue;
    }

    // Si esta línea cierra primero, bajamos nivel antes de imprimir
    if (line.startsWith("}")) {
      // ¿cerramos un switch?
      if (switchLevels.length && switchLevels[switchLevels.length - 1] === level - 1) {
        switchLevels.pop();
      }
      level = Math.max(level - 1, 0);
    }

    // Detectores simples
    const opensSwitch = /\bswitch\s*\(/.test(line) && line.includes("{");
    const controlStarters = [
      "if",
      "else if",
      "else",
      "for",
      "while",
      "do",
      "try",
      "catch",
      "finally"
    ];

    // CASE / DEFAULT (posible tail en la misma línea)
    const caseMatch = line.match(/^(case\b[\s\S]*?:|default:)\s*([\s\S]*)$/);
    if (caseMatch) {
      const label = caseMatch[1].trim();
      const tail = (caseMatch[2] ?? "").trim();

      // Label al nivel actual (nivel del switch)
      pushLine(level, label);

      if (tail) {
        const stmts = splitStatementsRespectingQuotes(tail);
        for (const s of stmts) {
          if (!s) continue;
          pushLine(level + 1, s);
        }
      }

      // Ajuste de nivel por llaves de la línea original
      const noStr = line
        .replace(/"([^"\\]|\\.)*"/g, '"s"')
        .replace(/'([^'\\]|\\.)*'/g, "'s'");
      const opens = (noStr.match(/\{/g) || []).length;
      const closes = (noStr.match(/\}/g) || []).length;
      if (opensSwitch) switchLevels.push(level);
      level += opens - closes;
      continue;
    }

    // Cabeceras de control (if/else/for/while/do/try/catch/finally)
    const isControl = startsWithAny(line, controlStarters);

    if (isControl) {
      // Caso 'do {' o 'try {' etc.
      const hasOpenBrace = /{\s*$/.test(line);
      const hasCloseBrace = /}\s*$/.test(line);

      // Caso "if (...) stmt;" (sin '{'): separar cabecera del resto
      if (!hasOpenBrace && /\)\s*[^{;]/.test(line)) {
        // divide en "header )" + "tail"
        const m = line.match(/^(.*\))\s*(.*)$/);
        if (m) {
          const header = m[1].trim();
          const tail = m[2].trim();

          pushLine(level, header);
          // Tail: sepárala en sentencias y colócalas un nivel dentro
          const stmts = splitStatementsRespectingQuotes(tail);
          for (const s of stmts) {
            if (!s) continue;
            // si empieza con '}' bajará al imprimir; aquí asumimos stmt simple
            pushLine(level + 1, s);
          }

          // Ajuste final por llaves que puedan venir en la cola (no habitual)
          const noStr = tail
            .replace(/"([^"\\]|\\.)*"/g, '"s"')
            .replace(/'([^'\\]|\\.)*'/g, "'s'");
          const opens = (noStr.match(/\{/g) || []).length;
          const closes = (noStr.match(/\}/g) || []).length;
          level += opens - closes;
          continue;
        }
      }

      // Línea de control "normal": imprimirla tal cual al nivel actual
      pushLine(level, line);

      // Si abre bloque '{' al final, subimos nivel
      if (hasOpenBrace && !hasCloseBrace) {
        if (/\bswitch\s*\(/.test(line)) switchLevels.push(level);
        level += 1;
      } else {
        // sin llave… el posible cuerpo vendrá en líneas siguientes y se reindenta por sentencias
      }

      // Ajuste por conteo de llaves extrañas en la misma línea
      if (!hasOpenBrace || hasCloseBrace) {
        const noStr = line
          .replace(/"([^"\\]|\\.)*"/g, '"s"')
          .replace(/'([^'\\]|\\.)*'/g, "'s'");
        const opens = (noStr.match(/\{/g) || []).length;
        const closes = (noStr.match(/\}/g) || []).length;
        if (opensSwitch) switchLevels.push(level);
        level += opens - closes;
      }
      continue;
    }

    // Reflow general de sentencias separadas por ';'
    const parts = splitStatementsRespectingQuotes(line);
    // ¿Estamos justo dentro de un switch?
    const insideSwitch = switchLevels.length && switchLevels[switchLevels.length - 1] === level;

    for (const stmtRaw of parts) {
      let stmt = stmtRaw.trim();
      if (!stmt) continue;

      // Si comienza cerrando bloque, baja un nivel esta sentencia
      let useLevel = level;
      if (stmt.startsWith("}")) {
        // ¿cerramos bloque de switch?
        if (switchLevels.length && switchLevels[switchLevels.length - 1] === level - 1) {
          switchLevels.pop();
        }
        useLevel = Math.max(useLevel - 1, 0);
      }

      // Si es un case/default (sin los dos puntos) deja que pase por el branch de arriba;
      // aquí tratamos solo sentencias "normales".
      if (!looksLikeCaseLabel(stmt) && insideSwitch) {
        // cuerpo de switch va un nivel más dentro
        useLevel += 1;
      }

      pushLine(useLevel, stmt);
    }

    // Ajuste global por llaves de la línea original
    const noStrings = line
      .replace(/"([^"\\]|\\.)*"/g, '"s"')
      .replace(/'([^'\\]|\\.)*'/g, "'s'");
    const opens = (noStrings.match(/\{/g) || []).length;
    const closes = (noStrings.match(/\}/g) || []).length;
    level += opens - closes;

    // Salida de switch si hemos cerrado su bloque
    if (switchLevels.length && switchLevels[switchLevels.length - 1] >= level) {
      switchLevels.pop();
    }
  }

  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Segmentación JSP                                                    */
/* ------------------------------------------------------------------ */

function splitIntoSegments(input: string): Segment[] {
  const parts = input.split(JSP_BLOCK_RE);
  const segments: Segment[] = [];

  for (const part of parts) {
    if (part.startsWith("<%") && part.endsWith("%>")) {
      const rawBody = part.slice(2, -2);
      const trimmed = rawBody.trim();

      const isDirective = /^<%\s*@/.test(part);
      const isExpr = /^<%\s*=/.test(part);
      const isDecl = /^<%\s*!/.test(part);

      if (isDirective) {
        const inner = trimmed.replace(/^@+/, "").trim();
        segments.push({ kind: "jsp-directive", raw: part, inner });
      } else if (isExpr) {
        const inner = rawBody.replace(/^[\s=]+/, "").replace(/\s+$/, "");
        segments.push({ kind: "jsp-expr", raw: part, inner });
      } else if (isDecl) {
        const inner = stripCommonIndent(rawBody.replace(/^[\s!]+/, ""));
        segments.push({ kind: "jsp-decl", raw: part, inner: inner.trimEnd() });
      } else {
        const inner = stripCommonIndent(trimmed);
        segments.push({
          kind: "jsp-scriptlet",
          raw: part,
          inner: inner.trimEnd()
        });
      }
    } else if (part.length) {
      segments.push({ kind: "html", text: part });
    }
  }
  return segments;
}

/* ------------------------------------------------------------------ */
/* Directivas JSP: normalización simple                                */
/* ------------------------------------------------------------------ */

function normalizeDirective(inner: string): string {
  const s = inner.replace(/^@+/, "").trim();
  const m = s.match(/^(\w+)\s*/);
  if (!m) return s;
  const name = m[1];
  const rest = s.slice(m[0].length);

  const pairs: Array<{ k: string; v: string }> = [];
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s"'>]+))/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(rest)) !== null) {
    pairs.push({ k: a[1], v: a[2] ?? a[3] ?? "" });
  }

  if (!pairs.length && /["']/.test(rest)) return s;

  pairs.sort((p, q) => p.k.localeCompare(q.k));
  const attrs = pairs.map(({ k, v }) => `${k}="${v}"`).join(" ");
  return attrs ? `${name} ${attrs}` : name;
}

/* ------------------------------------------------------------------ */
/* Prettier (plugin Java)                                              */
/* ------------------------------------------------------------------ */

function extractMethodBody(
  formatted: string,
  methodSignature: string
): string | null {
  const sigIdx = formatted.indexOf(methodSignature);
  if (sigIdx === -1) return null;
  let i = formatted.indexOf("{", sigIdx);
  if (i === -1) return null;
  i++;
  let depth = 1;
  const start = i;
  for (; i < formatted.length; i++) {
    const ch = formatted[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return formatted.slice(start, i).trim();
    }
  }
  return null;
}

let disableJavaPluginForThisRun = false;

async function tryFormatJavaFragment(
  code: string,
  mode: "scriptlet" | "decl" | "expr",
  tabWidth: number,
  useTabs: boolean
): Promise<string | null> {
  if (disableJavaPluginForThisRun) return null;

  try {
    const mod: any = await import("prettier-plugin-java");
    const plugin = mod?.default ?? mod;
    console.log("[JSP Formatter] prettier-plugin-java OK");

    if (mode === "expr") return code.trim();

    const wrapped =
      mode === "decl"
        ? `class __J { ${code} }`
        : `class __J { void __m() { ${code} } }`;

    const formatted = await prettier.format(wrapped, {
      parser: "java",
      plugins: [plugin],
      tabWidth,
      useTabs
    });

    if (mode === "decl") {
      const open = formatted.indexOf("{");
      const close = formatted.lastIndexOf("}");
      if (open !== -1 && close !== -1 && close > open) {
        return formatted.slice(open + 1, close).trim();
      }
      return code.trim();
    } else {
      const body = extractMethodBody(formatted, "void __m()");
      return body ?? code.trim();
    }
  } catch (e) {
    console.warn(
      "[JSP Formatter] Plugin Java falló; desactivado para el resto de este archivo. Usando fallback bonito.",
      e
    );
    disableJavaPluginForThisRun = true;
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Reinserción con sangría base y blockIndent                          */
/* ------------------------------------------------------------------ */

function getLineBounds(text: string, idx: number) {
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  let lineEnd = text.indexOf("\n", idx);
  if (lineEnd === -1) lineEnd = text.length;
  return { lineStart, lineEnd };
}

function getIndentAt(text: string, pos: number) {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const m = text.slice(lineStart, pos).match(/^[\t ]*/);
  return m ? m[0] : "";
}

/** Aplica:
 *  - delimitadores <% y %> al nivel base del HTML
 *  - contenido del bloque con +blockIndentSpaces
 */
function applyBlockIndentPerRole(
  blockRaw: string,
  baseIndent: string,
  blockIndentSpaces: number
): string {
  const lines = blockRaw.split("\n");

  if (lines.length === 1) {
    return baseIndent + lines[0].replace(/^[\t ]+/, "");
  }

  const padInside = " ".repeat(blockIndentSpaces);

  return lines
    .map((l, i) => {
      const clean = l.replace(/^[\t ]+/, "");
      if (i === 0 || i === lines.length - 1) {
        return baseIndent + clean;
      }
      return baseIndent + padInside + clean;
    })
    .join("\n");
}

/** Reemplaza <jspfmt data-i="N"></jspfmt> por el bloque JSP en esa línea */
function replaceElementTokenWithBlock(
  whole: string,
  token: string,
  blockRaw: string,
  blockIndentSpaces: number
): string {
  const idx = whole.indexOf(token);
  if (idx === -1) return whole;

  const { lineStart, lineEnd } = getLineBounds(whole, idx);
  const baseIndent = getIndentAt(whole, idx);

  // %><% pegados → salto extra antes
  const prevTwo = whole.slice(Math.max(0, idx - 2), idx);
  const needsLeadingNewline = prevTwo.endsWith("%>");

  let block = blockRaw
    .split("\n")
    .map((l) => l.replace(/^[\t ]+/, ""))
    .join("\n");

  block = applyBlockIndentPerRole(block, baseIndent, blockIndentSpaces);

  if (needsLeadingNewline && !block.startsWith("\n")) {
    block = "\n" + block;
  }

  return whole.slice(0, lineStart) + block + whole.slice(lineEnd);
}

/* ------------------------------------------------------------------ */
/* Formateo principal del documento JSP                                */
/* ------------------------------------------------------------------ */

export async function formatJspDocument(
  input: string,
  opts: Options
): Promise<string> {
  disableJavaPluginForThisRun = false;

  const segments = splitIntoSegments(input);

  // Elemento placeholder para que Prettier lo indente como bloque
  const placeholderOf = (i: number) => `<jspfmt data-i="${i}"></jspfmt>`;

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

  // Prettier sobre HTML
  let formattedHtml = htmlBuffer;
  try {
    formattedHtml = await prettier.format(htmlBuffer, {
      parser: "html",
      tabWidth: opts.tabWidth,
      useTabs: opts.useTabs
    });
  } catch {
    formattedHtml = htmlBuffer;
  }

  // Reinsertar JSP
  let out = formattedHtml;

  for (let p = 0; p < placeholderMap.length; p++) {
    const seg = segments[placeholderMap[p].indexInSegments];
    if (!seg || seg.kind === "html") continue;

    let block = seg.raw;

    if (seg.kind === "jsp-directive") {
      const body = normalizeDirective(seg.inner);
      block = `<%@ ${body} %>`;
    } else if (seg.kind === "jsp-expr") {
      block = `<%= ${seg.inner.trim()} %>`;
    } else if (seg.kind === "jsp-decl") {
      if (opts.javaFormat === "off") {
        block = `<%! ${seg.inner} %>`;
      } else if (opts.javaFormat === "indent-only") {
        block = `<%!\n${formatJavaPrettyFallback(
          stripCommonIndent(seg.inner),
          opts.tabWidth
        )}\n%>`;
      } else {
        const java = await tryFormatJavaFragment(
          stripCommonIndent(seg.inner),
          "decl",
          opts.tabWidth,
          opts.useTabs
        );
        block = java
          ? `<%!\n${java}\n%>`
          : `<%!\n${formatJavaPrettyFallback(
              stripCommonIndent(seg.inner),
              opts.tabWidth
            )}\n%>`;
      }
    } else if (seg.kind === "jsp-scriptlet") {
      if (opts.javaFormat === "off") {
        block = `<% ${seg.inner} %>`;
      } else if (opts.javaFormat === "indent-only") {
        block = `<%\n${formatJavaPrettyFallback(
          stripCommonIndent(seg.inner),
          opts.tabWidth
        )}\n%>`;
      } else {
        const java = await tryFormatJavaFragment(
          stripCommonIndent(seg.inner),
          "scriptlet",
          opts.tabWidth,
          opts.useTabs
        );
        block = java
          ? `<%\n${java}\n%>`
          : `<%\n${formatJavaPrettyFallback(
              stripCommonIndent(seg.inner),
              opts.tabWidth
            )}\n%>`;
      }
    }

    out = replaceElementTokenWithBlock(
      out,
      placeholderOf(p),
      block,
      opts.blockIndent
    );
  }

  return out;
}
