import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Semi 组件各自引入默认样式（@douyinfe/semi-ui、semi-foundation 的 lib/es/**.css）。
 * 我们用主题包里编译好的整套样式（index.css 引入），所以把组件自带的样式清空，避免默认主题覆盖主题包。
 * 组件里多是相对路径引入，所以按解析后的文件路径判断。
 */
function semiTheme(): Plugin {
  const semiCss = /[\\/]@douyinfe[\\/]semi-(ui|foundation)[\\/]lib[\\/]es[\\/].+\.css$/;
  return {
    name: "semi-theme",
    enforce: "pre",
    load(id) {
      return semiCss.test(id.split("?")[0] ?? id) ? "" : null;
    },
  };
}

export default defineConfig({
  plugins: [semiTheme(), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
