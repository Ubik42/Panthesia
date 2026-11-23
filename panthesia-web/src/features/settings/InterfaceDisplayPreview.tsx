import {
  displayPitch,
  handColor,
  productLabel,
  type DisplayPreferences,
} from "./displayPreferences";
import { effectPalettes } from "../practice/pianoEffects";

const whites = [60, 62, 64, 65, 67, 69, 71, 72];
const blacks = [
  { pitch: 61, after: 0 },
  { pitch: 63, after: 1 },
  { pitch: 66, after: 3 },
  { pitch: 68, after: 4 },
  { pitch: 70, after: 5 },
];
export function InterfaceDisplayPreview({
  value,
}: {
  value: DisplayPreferences;
}) {
  const label = (pitch: number) => productLabel(pitch,"key",value,{own:true,finger:pitch===60?1:null});
  const notes = [
    { pitch: 60, x: 9, width: 56, y: 44, height: 52, hand: "left", finger: 5 },
    {
      pitch: 64,
      x: 133,
      width: 56,
      y: 21,
      height: 75,
      hand: "right",
      finger: null,
    },
    {
      pitch: 67,
      x: 257,
      width: 56,
      y: 55,
      height: 41,
      hand: "right",
      finger: 2,
    },
  ];
  return (
    <figure className="interface-display-preview">
      <figcaption>
        <strong>提示预览</strong>
        <span>C4–C5 · 左手与右手</span>
      </figcaption>
      <svg
        viewBox="0 0 508 188"
        role="img"
        aria-label={`音符名称与配色预览，示例音符为 ${[60, 64, 67].map((pitch) => displayPitch(pitch, value)).join("、")}`}
      >
        <rect width="508" height="102" rx="7" fill="#18212b" />
        {[1, 2, 3, 4, 5, 6, 7].map((index) => (
          <path
            key={index}
            d={`M ${index * 62 + 5} 0 V 102`}
            stroke="#34414e"
            strokeWidth="1"
          />
        ))}
        {Array.from({length:value.gridSubdivision},(_,index)=><path key={`grid-${index}`} d={`M 5 ${index*96/value.gridSubdivision} H 503`} stroke="#c9d3e8" strokeOpacity={(index===0?value.barOpacity:index%(value.gridSubdivision/4)===0?value.beatOpacity:value.subdivisionOpacity)/100} strokeWidth={index===0?1.5:.7} strokeDasharray={index%(value.gridSubdivision/4)?"3 5":undefined}/>)}
        <path d="M 5 97 H 503" stroke={effectPalettes[value.effectsPalette].right} strokeWidth="2" />
        {notes.map((note) => (
          <g key={note.pitch}>
            <rect
              x={note.x}
              y={note.y}
              width={note.width}
              height={note.height}
              rx="5"
              fill={value.palette === "accessible" ? handColor(note.hand, value) : effectPalettes[value.effectsPalette][note.hand === "left" ? "left" : "right"]}
            />
            <text
              x={note.x + note.width / 2}
              y={note.y + note.height / 2 + 5}
              textAnchor="middle"
              fontSize={value.fontSize}
              fill="#142032"
              fontWeight="650"
            >
              {productLabel(note.pitch,"note",value,{own:note.hand==="right",finger:note.finger})}
            </text>
          </g>
        ))}
        {whites.map((pitch, index) => (
          <g key={pitch}>
            <rect
              x={index * 62 + 6}
              y="103"
              width="60"
              height="78"
              rx="3"
              fill={value.pianoMaterial==="glass"?"#83a9bb":value.pianoMaterial==="ivory"?"#f3e6c7":"#f4f7ff"}
              stroke="#96a4ad"
            />
            <text
              x={index * 62 + 36}
              y="168"
              textAnchor="middle"
              fontSize={value.fontSize}
              fill="#384657"
            >
              {label(pitch)}
            </text>
          </g>
        ))}
        {blacks.map(({ pitch, after }) => (
          <g key={pitch}>
            <rect
              x={(after + 1) * 62 - 13}
              y="102"
              width="36"
              height="47"
              rx="3"
              fill="#263340"
              stroke="#121b24"
            />
            {!!label(pitch) && (
              <text
                x={(after + 1) * 62 + 5}
                y="136"
                textAnchor="middle"
                fontSize={Math.min(value.fontSize, 11)}
                fill="#e9eff4"
              >
                {label(pitch)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p>预览使用示例音符；实际曲目按已有指法与声部显示。</p>
    </figure>
  );
}
