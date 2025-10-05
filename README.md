# 🧩 JSP Formatter — VS Code Extension

**JSP Formatter** es una extensión para Visual Studio Code desarrollada por [josalello](https://github.com/josalello) que permite **formatear archivos JSP** (`.jsp`, `.jspx`) de forma precisa y elegante, respetando la estructura HTML y el código Java embebido.

Incluye además **resaltado de sintaxis (syntax highlighting)** para HTML, Java y directivas JSP, sin necesidad de instalar ninguna extensión adicional.

---

## ✨ Características principales

- 🔧 **Formateo completo** de HTML y Java embebido dentro de `<% %>`, `<%! %>`, `<%= %>` y `<%@ %>`.
- 🧠 **Integración con Prettier** y el plugin `prettier-plugin-java` para dar formato al código Java.
- 🎨 **Resaltado de sintaxis** para JSP, con gramática propia incluida.
- 🧱 **Indentación coherente** con el nivel del HTML en el que se encuentra el bloque JSP.
- ↩️ **Saltos automáticos** entre bloques JSP consecutivos (`%><%` → `%>
<%`).
- ⚙️ Configurable desde `settings.json`:
  ```json
  "jspFormatter.tabWidth": 2,
  "jspFormatter.useTabs": false,
  "jspFormatter.javaFormat": "auto" // auto | indent-only | off
  ```
- 🗂️ Soporte para `.jsp` y `.jspx`.

---

## 🧩 Instalación

Puedes instalar la extensión de dos maneras:

### Opción 1 — Desde el `.vsix` incluido
En el repositorio se incluye el paquete compilado listo para instalar:

1. Abre VS Code.  
2. Pulsa `Ctrl+Shift+P` → **Extensions: Install from VSIX...**  
3. Selecciona el archivo  
   ```
   jsp-formatter-0.1.0.vsix
   ```
4. Recarga VS Code y abre un archivo `.jsp`.

---

### Opción 2 — Compilar manualmente

Si prefieres construir la extensión desde el código fuente:

1. Clona este repositorio:
   ```bash
   git clone https://github.com/josalello/vscode-jsp-extension.git
   cd vscode-jsp-extension
   ```
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Compila TypeScript:
   ```bash
   npm run compile
   ```
4. Empaqueta la extensión:
   ```bash
   npx vsce package
   ```
   Esto generará un archivo `.vsix` en la carpeta raíz (por ejemplo, `jsp-formatter-0.1.0.vsix`).

5. Instálalo con:
   ```bash
   code --install-extension jsp-formatter-0.1.0.vsix
   ```

---

## ⚙️ Configuración recomendada en VS Code

En tu archivo `settings.json`, añade:

```json
"files.associations": {
  "*.jsp": "jsp",
  "*.jspx": "jsp"
},
"[jsp]": {
  "editor.defaultFormatter": "josalello.jsp-formatter",
  "editor.formatOnSave": true
},
"jspFormatter.tabWidth": 2,
"jspFormatter.useTabs": false,
"jspFormatter.javaFormat": "auto"
```

---

## 🚀 Uso

1. Abre cualquier archivo `.jsp`.
2. Pulsa **Alt + Shift + F** o selecciona **Format Document**.
3. El archivo se reformateará automáticamente respetando la indentación del HTML y del Java embebido.

Ejemplo:

Antes:
```jsp
<%@page contentType="text/html" language="java"%><html><body><%int x=3;if(x>2){out.println("Mayor");}else{out.println("Menor");}%></body></html>
```

Después:
```jsp
<%@ page contentType="text/html" language="java" %>
<html>
  <body>
    <%
      int x = 3;
      if (x > 2) {
        out.println("Mayor");
      } else {
        out.println("Menor");
      }
    %>
  </body>
</html>
```

---

## 🧠 Tecnologías utilizadas

- **TypeScript**
- **VS Code API**
- **Prettier**  
- **prettier-plugin-java**
- **TextMate grammars** para el resaltado de sintaxis (HTML + Java)

---

## 🧰 Estructura del proyecto

```
jsp-formatter/
├─ src/
│  ├─ extension.ts          # Registro del proveedor de formato
│  └─ formatter.ts          # Lógica principal de formateo
├─ syntaxes/
│  └─ jsp.tmLanguage.json   # Gramática de colores (HTML + Java)
├─ language-configuration.json
├─ package.json             # Metadatos y contribuciones
├─ tsconfig.json
├─ .vscodeignore
└─ jsp-formatter-0.1.0.vsix # Paquete instalable (opcional)
```

---

## 👤 Autor

**José Luis Alegre Llopis (josalello)**  
📍 Sagunto (Valencia, España)  
🔗 [https://github.com/josalello](https://github.com/josalello)

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**.  
Eres libre de usar, modificar y redistribuir la extensión, citando al autor original.

---