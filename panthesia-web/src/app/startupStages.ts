export const startupStages: Record<string, [string, string]> = {
  connecting: ["正在连接练习室", "连接练习室并读取当前状态。"],
  preparingSound: [
    "正在准备钢琴音源",
    "读取音色与采样。界面会在准备完成后进入练习室。",
  ],
  connectingInput: ["正在连接 MIDI 键盘", "读取上次选择的键盘与连接状态。"],
  connectingOutput: ["正在连接声音设备", "准备上次选择的乐器或内置钢琴。"],
  recovering: ["正在恢复练习室", "读取上次保存的设置与练习记录。"],
  restoringSong: [
    "正在准备上次曲目",
    "读取音符、指法和谱面。曲库也在后台整理。",
  ],
  skippingSong: ["正在跳过上次曲目", "完成当前读取后进入练习室。"],
  installing: ["正在恢复练习设置", "安装曲目并恢复速度、练习范围与设备状态。"],
};

export const startupFailureTitles: Record<string, string> = {
  preparingSound: "钢琴声音暂未准备好",
  restoringSong: "上次曲目暂时无法打开",
  installing: "练习资料安装未完成",
  connectingInput: "MIDI 键盘准备未完成",
  connectingOutput: "声音设备准备未完成",
  recovering: "练习资料恢复尚未完成",
};
