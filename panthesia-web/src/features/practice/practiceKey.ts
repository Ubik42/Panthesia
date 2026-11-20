import type {LoadedSong} from "../../engine/sessionTypes";
const defaultKey={tonic:0,fifths:0,minor:false};
/** Note labels use their onset; piano key labels use the current transport time. */
export function practiceKeyAt(variant:LoadedSong["practiceVariant"],at:number){
  const keys=variant?.keyChanges;
  if(keys?.length){let low=0,high=keys.length;while(low<high){const mid=(low+high)>>>1;if(keys[mid].at<=at)low=mid+1;else high=mid;}return keys[Math.max(0,low-1)];}
  return variant?{tonic:variant.effectiveTonic??variant.tonic,fifths:variant.effectiveFifths,minor:variant.minor}:defaultKey;
}
