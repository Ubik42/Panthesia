export type NotationReadRequest =
  | {type:"begin";id:string;size:number}
  | {type:"append";id:string;offset:number;bytes:number[]}
  | {type:"prepare"|"touch"|"release";id:string}
  | {type:"window";id:string;first:number};
export interface NotationReadWindow {
  readerId:string;
  bytes:number[];
  compressed:false;
  range:{first:number;count:number;total:number;previous:number|null;next:number|null;firstNumber:string;lastNumber:string};
}
