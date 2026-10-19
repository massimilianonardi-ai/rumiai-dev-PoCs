import{n as e}from"./f025431a-ehagpvg3m4e1cduv.js";function t(e){return r.test(e)}function n({svgMarkup:e}){return`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: transparent;
      }

      #diagram {
        width: 100%;
        height: 100%;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        box-sizing: border-box;
      }

      #diagram > img {
        display: block;
        max-width: 100%;
        max-height: 100%;
      }

      pre {
        margin: 0;
        padding: 16px;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div id="diagram"></div>
    <script>
      (() => {
        const container = document.getElementById("diagram");
        if (!container) return;

        const showError = (message) => {
          container.innerHTML = "<pre>" + message + "</pre>";
        };

        let svgSource;
        try {
          svgSource = decodeURIComponent(${JSON.stringify(encodeURIComponent(e))});
        } catch (error) {
          showError("Invalid SVG source.");
          console.error(error);
          return;
        }

        const template = document.createElement("template");
        template.innerHTML = svgSource;

        const svgElement = template.content.querySelector("svg");
        if (!svgElement) {
          showError("Invalid SVG source.");
          return;
        }

        // HTML serialization drops implicit SVG namespaces needed by image decoders.
        const healedSVG = new XMLSerializer()
          .serializeToString(svgElement)
          .replace(/\\s*<!-{4,}>\\s*(?=(?:<\\/[a-zA-Z][^>]*>\\s*)*$)/g, "")
          .replace(/\\s*&lt;\\s*(?=(?:<\\/[a-zA-Z][^>]*>\\s*)*$)/g, "");

        if (!healedSVG.trim()) {
          showError("Invalid SVG source.");
          return;
        }

        const image = document.createElement("img");
        image.alt = "SVG preview";
        image.src =
          "data:image/svg+xml;utf8," + encodeURIComponent(healedSVG);

        container.innerHTML = "";
        container.appendChild(image);
      })();
    <\/script>
  </body>
</html>`}var r,i=e((()=>{r=/^\uFEFF?\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!doctype\s+svg\b[^>]*>\s*)?<svg\b/i}));export{t as n,i as r,n as t};
//# sourceMappingURL=c01cad0d-kcla04z8lzj7ivsr.js.map