import { defineConfig } from "vitepress";
export default defineConfig({
  title: "Panthesia",
  description: "原创钢琴练习软件：Synthesia 交互复刻与后台音乐能力",
  base: "/Panthesia/",
  themeConfig: {
    nav: [{text:"首页",link:"/"},{text:"启动",link:"/pages/installation"},{text:"工程计划",link:"/development/current-plan"}],
    sidebar:[{text:"工程",items:[
      {text:"文档入口",link:"/development/README"},
      {text:"当前计划",link:"/development/current-plan"},
      {text:"Goal 提示词",link:"/development/current-goal"},
      {text:"工程调查",link:"/development/engineering-audit"},
      {text:"交互规范",link:"/development/interaction-model"},
      {text:"架构决策",link:"/development/architecture-decisions"},
      {text:"歌曲数据",link:"/development/song-core"},
      {text:"原创替换",link:"/development/source-independence"},
      {text:"当前交接",link:"/development/modernization-handoff"}
    ]}],
    socialLinks:[{icon:"github",link:"https://github.com/Ubik42/Panthesia"}]
  }
});
