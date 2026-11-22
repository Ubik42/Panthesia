import { defineConfig } from "vitepress";
export default defineConfig({
  title: "Panthesia",
  description: "开源钢琴练习软件",
  base: "/Panthesia/",
  themeConfig: {
    nav: [{ text: "首页", link: "/" }, { text: "启动", link: "/pages/installation" }, { text: "开发计划", link: "/development/current-plan" }],
    sidebar: [
      { text: "使用", items: [
        { text: "启动", link: "/pages/installation" },
        { text: "使用说明", link: "/pages/guide" }
      ] },
      { text: "开发", items: [
        { text: "文档入口", link: "/development/README" },
        { text: "开发计划", link: "/development/current-plan" },
        { text: "进度记录", link: "/development/progress" },
        { text: "界面规范", link: "/development/interface-design" },
        { text: "架构决策", link: "/development/architecture-decisions" },
        { text: "清单格式", link: "/development/panthesia-format" },
        { text: "音乐模型", link: "/development/music-model" },
        { text: "舞台渲染", link: "/development/stage-rendering" },
        { text: "来源与许可", link: "/development/sources-and-licences" }
      ] }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/Ubik42/Panthesia" }]
  }
});
