pub mod cross_transfer;
pub mod source_monitor;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
const MAX_BYTES: usize = 48_000_000;
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageAsset {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub size: usize,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct View {
    pub page: usize,
    pub zoom: u16,
    pub fit: bool,
    pub rotation: u16,
}
impl Default for View {
    fn default() -> Self {
        Self {
            page: 1,
            zoom: 100,
            fit: true,
            rotation: 0,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub format: String,
    pub pages: Vec<PageAsset>,
    pub view: View,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mapping: Option<Mapping>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<Annotation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_anchors: Vec<NoteAnchor>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub sources: std::collections::BTreeMap<String, PaperSource>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PaperSource { pub path: PathBuf, #[serde(default)] pub ignored: Option<String> }
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct TransferAnnotation { pub id:String, pub asset_id:String, pub page:usize, pub x:f32, pub y:f32 }
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PaperTransfer {
    pub source:String,pub target:String,pub baseline:String,pub annotations:Vec<TransferAnnotation>,
    pub anchors:Vec<PageAnchor>,#[serde(default)]pub replace_anchors:bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct InkStroke {pub points:Vec<[f32;2]>,pub thickness:f32}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub asset_id: String,
    pub page: usize,
    pub x: f32,
    pub y: f32,
    pub text: String,
    pub color: String,
    #[serde(default,skip_serializing_if="Option::is_none")] pub width:Option<f32>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub height:Option<f32>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub ink:Option<InkStroke>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDraft {
    pub asset_id: String,
    pub page: usize,
    pub x: f32,
    pub y: f32,
    pub text: String,
    pub color: String,
    #[serde(default,skip_serializing_if="Option::is_none")] pub width:Option<f32>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub height:Option<f32>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub ink:Option<InkStroke>,
}
pub fn validate_annotations(
    notes: &[Annotation],
    format: &str,
    assets: &[String],
) -> Result<(), String> {
    if notes.len() > 2000 {
        return Err("一份谱面最多 2000 条批注".into());
    }
    if notes.iter().filter_map(|n|n.ink.as_ref()).map(|i|i.points.len()).sum::<usize>()>200_000{return Err("一份谱面笔迹超过 20 万点，请分到其他谱面版本".into());}
    let mut ids = std::collections::BTreeSet::new();
    for n in notes {
        if n.id.is_empty()
            || n.id.len() > 80
            || !ids.insert(&n.id)
            || !assets.contains(&n.asset_id)
            || n.page == 0
            || n.page > 5000
            || (format == "images" && n.page != 1)
            || !n.x.is_finite()
            || !n.y.is_finite()
            || !(0.0..=1.0).contains(&n.x)
            || !(0.0..=1.0).contains(&n.y)
            || n.text.trim().is_empty()&&n.width.is_none()
            || match (n.width,n.height){(None,None)=>false,(Some(w),Some(h))=>!w.is_finite()||!h.is_finite()||w<0.002||h<0.002||n.x+w>1.000001||n.y+h>1.000001,_=>true}
            || n.ink.as_ref().is_some_and(|i|n.width.is_none()||n.height.is_none()||i.points.len()<2||i.points.len()>4096||!i.thickness.is_finite()||!(0.0005..=0.02).contains(&i.thickness)||i.points.iter().flatten().any(|p|!p.is_finite()||!(0.0..=1.0).contains(p)))
            || n.text.chars().count() > 400
            || n.text
                .chars()
                .any(|c| c.is_control() && !['\n', '\t'].contains(&c))
            || !["yellow", "blue", "green", "red"].contains(&n.color.as_str())
        {
            return Err("批注文字、位置、谱页身份或颜色无效".into());
        }
    }
    Ok(())
}
pub fn edit_annotation(
    data: &Path,
    cid: &str,
    book: &str,
    id: Option<&str>,
    draft: Option<AnnotationDraft>,
    expected: Option<Annotation>,
) -> Result<Value, String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let mut s = load(data, cid)?;
    let a = s
        .attachments
        .iter_mut()
        .find(|a| a.id == book)
        .ok_or("谱面版本不存在")?;
    let at = if let Some(id) = id {
        let at = a
            .annotations
            .iter()
            .position(|n| n.id == id)
            .ok_or("批注已被移除，请重新打开")?;
        if expected.as_ref() != Some(&a.annotations[at]) {
            return Err("批注已在其他窗口改变，请重新打开后修改".into());
        }
        Some(at)
    } else {
        if expected.is_some() {
            return Err("新批注条件无效".into());
        }
        None
    };
    if let Some(d) = draft {
        let note = Annotation {
            id: id.map(str::to_string).unwrap_or_else(|| {
                blake3::hash(
                    format!(
                        "{}:{}:{:?}",
                        cid,
                        a.annotations.len(),
                        std::time::SystemTime::now()
                    )
                    .as_bytes(),
                )
                .to_hex()
                .to_string()
            }),
            asset_id: d.asset_id,
            page: d.page,
            x: d.x,
            y: d.y,
            text: d.text.trim().to_string(),
            color: d.color,
            width:d.width,height:d.height,ink:d.ink,
        };
        if let Some(at) = at {
            a.annotations[at] = note;
        } else {
            a.annotations.push(note);
        }
        validate_annotations(
            &a.annotations,
            &a.format,
            &a.pages.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
        )?;
    } else if let Some(at) = at {
        a.annotations.remove(at);
    } else {
        return Err("未指定批注".into());
    }
    save(data, &s)?;
    describe(data, &s)
}
/// Replace only this page's freehand marks; text and highlights remain independent.
pub fn edit_ink(data:&Path,cid:&str,book:&str,asset:&str,page:usize,expected:Vec<Annotation>,strokes:Vec<Annotation>)->Result<Value,String>{
 let lock=crate::data_locks::lock_for(data)?;let _guard=lock.lock().map_err(|_|"谱页目录正忙")?;
 let mut store=load(data,cid)?;let a=store.attachments.iter_mut().find(|a|a.id==book).ok_or("谱面版本不存在")?;
 if !a.pages.iter().any(|p|p.id==asset)||page==0||page>5000||a.format=="images"&&page!=1{return Err("谱页身份或页码无效".into());}
 let same=|n:&Annotation|n.asset_id==asset&&n.page==page&&n.ink.is_some();
 let current=a.annotations.iter().filter(|n|same(n)).cloned().collect::<Vec<_>>();
 if current!=expected{return Err("本页笔迹已在其他窗口改变，请暂存草稿后重新核对".into());}
 if strokes.iter().any(|n|!same(n)){return Err("笔迹只能保存到当前页，未保存".into());}
 let mut notes=a.annotations.iter().filter(|n|!same(n)).cloned().collect::<Vec<_>>();notes.extend(strokes);
 validate_annotations(&notes,&a.format,&a.pages.iter().map(|p|p.id.clone()).collect::<Vec<_>>())?;
 a.annotations=notes;save(data,&store)?;describe(data,&store)
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageAnchor {
    pub measure: usize,
    pub page: usize,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub region: Option<PageRegion>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct PageRegion { pub x:f32, pub y:f32, pub width:f32, pub height:f32 }
impl PageRegion {
    fn validate(&self)->Result<(),String>{
        if ![self.x,self.y,self.width,self.height].iter().all(|v|v.is_finite()) || self.x<0. || self.y<0. || self.width<0.002 || self.height<0.002 || self.x+self.width>1.000001 || self.y+self.height>1.000001 {
            return Err("谱页小节位置需在页内，区域不能为空".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct NoteAnchor {
    pub grid:String,
    pub track:usize,
    pub index:usize,
    pub pitch:u8,
    pub measure:usize,
    pub asset_id:String,
    pub page:usize,
    pub region:PageRegion,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct NoteAnchorDraft {
    pub pitch:u8,
    pub measure:usize,
    pub asset_id:String,
    pub page:usize,
    pub region:PageRegion,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct NoteAnchorEdit {
    pub track:usize,
    pub index:usize,
    pub draft:NoteAnchorDraft,
    #[serde(default)] pub expected:Option<NoteAnchor>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct LocatedNoteDraft {
    pub track:usize,
    pub index:usize,
    pub pitch:u8,
    pub measure:usize,
    pub page:usize,
    pub renderer_id:String,
    pub region:PageRegion,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocatedPaperUpload {
    pub content_id:String,
    pub score_revision:u64,
    pub source_fingerprint:String,
    pub mapping_token:String,
    pub name:String,
    pub page_count:usize,
    pub anchors:Vec<LocatedNoteDraft>,
}
/// Binary upload: NLP1, little-endian metadata length, JSON metadata,
/// then one little-endian length and the PNG bytes for each declared page.
/// Parse the complete frame before forwarding it to the song-bound command.
pub fn decode_located_paper_upload(bytes:&[u8])->Result<(LocatedPaperUpload,Vec<Vec<u8>>),String>{
    if bytes.len()>50_100_000||bytes.len()<8||&bytes[..4]!=b"NLP1" {return Err("可定位纸谱数据格式或容量无效".into());}
    let mut offset=4usize;
    fn read_len(bytes:&[u8],offset:&mut usize)->Result<usize,String>{
        let end=offset.checked_add(4).ok_or("谱页长度无效")?;
        let part=bytes.get(*offset..end).ok_or("谱页数据不完整")?;
        *offset=end;
        Ok(u32::from_le_bytes(part.try_into().unwrap()) as usize)
    }
    let meta_len=read_len(bytes,&mut offset)?;
    if meta_len==0||meta_len>2_000_000{return Err("纸谱说明超过容量上限".into());}
    let end=offset.checked_add(meta_len).ok_or("纸谱说明长度无效")?;
    let meta:LocatedPaperUpload=serde_json::from_slice(bytes.get(offset..end).ok_or("纸谱说明不完整")?).map_err(|e|format!("纸谱说明无效：{e}"))?;
    offset=end;
    if meta.page_count==0||meta.page_count>80||meta.anchors.is_empty()||meta.anchors.len()>10000{return Err("纸谱页数或音符数量无效".into());}
    let mut pages=Vec::with_capacity(meta.page_count);
    let mut total=0usize;
    for _ in 0..meta.page_count {
        let len=read_len(bytes,&mut offset)?;
        total=total.checked_add(len).ok_or("谱页容量无效")?;
        if len==0||total>48_000_000{return Err("生成谱页超过 48 MB 容量上限".into());}
        let end=offset.checked_add(len).ok_or("谱页长度无效")?;
        pages.push(bytes.get(offset..end).ok_or("谱页数据不完整")?.to_vec());
        offset=end;
    }
    if offset!=bytes.len(){return Err("谱页数据末尾存在多余内容".into());}
    Ok((meta,pages))
}
pub fn validate_note_anchors(anchors:&[NoteAnchor],format:&str,pages:&[PageAsset])->Result<(),String>{
    if anchors.len()>10000{return Err("一份谱面最多标记 10000 个音符位置".into());}
    let mut identities=std::collections::BTreeSet::new();
    for a in anchors {
        a.region.validate()?;
        if a.grid.is_empty()||a.grid.len()>160||a.pitch>127||a.measure==0||a.measure>1_000_000||a.page==0||a.page>5000||!identities.insert((a.track,a.index))||
            (format=="images" && (a.page>pages.len()||pages[a.page-1].id!=a.asset_id))||
            (format=="pdf" && (pages.len()!=1||pages[0].id!=a.asset_id)) {
            return Err("音符位置的曲目、音符、谱页身份或页码无效".into());
        }
    }
    Ok(())
}
pub fn edit_note_anchor(data:&Path,cid:&str,book:&str,track:usize,index:usize,draft:Option<NoteAnchorDraft>,expected:Option<NoteAnchor>,grid:&str)->Result<Value,String>{
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut store=load(data,cid)?;let a=store.attachments.iter_mut().find(|a|a.id==book).ok_or("谱面版本不存在")?;
    let current=a.note_anchors.iter().position(|n|n.track==track&&n.index==index);
    if current.and_then(|i|a.note_anchors.get(i))!=expected.as_ref(){return Err("音符位置已在其他窗口改变，请重新打开谱面".into())}
    if let Some(d)=draft {
        let next=NoteAnchor{grid:grid.into(),track,index,pitch:d.pitch,measure:d.measure,asset_id:d.asset_id,page:d.page,region:d.region};
        if let Some(i)=current{a.note_anchors[i]=next;}else{a.note_anchors.push(next);}
    }else if let Some(i)=current{a.note_anchors.remove(i);}else{return Err("音符位置已被移除，请重新打开谱面".into());}
    validate_note_anchors(&a.note_anchors,&a.format,&a.pages)?;
    save(data,&store)?;describe(data,&store)
}
/// Validate the complete proposed result before writing. Existing anchors outside
/// the submitted identities stay untouched, including hand-placed anchors.
pub fn batch_note_anchors(data:&Path,cid:&str,book:&str,edits:Vec<NoteAnchorEdit>,grid:&str)->Result<Value,String>{
    if edits.is_empty()||edits.len()>10000 {return Err("请提交 1 至 10000 个音符位置".into());}
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut store=load(data,cid)?;
    let a=store.attachments.iter_mut().find(|a|a.id==book).ok_or("谱面版本不存在")?;
    let mut identities=std::collections::BTreeSet::new();
    for e in edits {
        if !identities.insert((e.track,e.index)){return Err("同一音符位置在本批次重复，请重新检查".into());}
        let current=a.note_anchors.iter().position(|n|n.track==e.track&&n.index==e.index);
        if current.and_then(|i|a.note_anchors.get(i))!=e.expected.as_ref(){return Err("音符位置已在其他窗口改变，请重新打开谱面".into());}
        let d=e.draft;
        let next=NoteAnchor{grid:grid.into(),track:e.track,index:e.index,pitch:d.pitch,measure:d.measure,asset_id:d.asset_id,page:d.page,region:d.region};
        if let Some(i)=current{a.note_anchors[i]=next;}else{a.note_anchors.push(next);}
    }
    validate_note_anchors(&a.note_anchors,&a.format,&a.pages)?;
    save(data,&store)?;describe(data,&store)
}
/// Publish a generated multi-page score only after every page and note position
/// has passed validation. Asset files may be staged before the manifest commit,
/// but an interrupted generation never exposes a partial attachment.
pub fn create_located_paper(data:&Path,cid:&str,name:&str,pages:Vec<Vec<u8>>,anchors:Vec<LocatedNoteDraft>,grid:&str,source_fingerprint:&str)->Result<Value,String>{
    if pages.is_empty()||pages.len()>80{return Err("图片谱面需有 1 至 80 页".into());}
    if anchors.is_empty()||anchors.len()>10000{return Err("自动定位需有 1 至 10000 个音符".into());}
    if pages.iter().map(Vec::len).sum::<usize>()>48_000_000{return Err("生成谱页超过 48 MB 容量上限".into());}
    let name=title(name)?;
    let mut assets=Vec::with_capacity(pages.len());
    let mut page_ids=std::collections::BTreeSet::new();
    for (i,bytes) in pages.iter().enumerate(){
        if kind(bytes)?!="png" {return Err("自动生成的谱页必须是 PNG 图片".into());}
        let id=blake3::hash(bytes).to_hex().to_string();
        if !page_ids.insert(id.clone()){return Err("生成的谱页内容重复，请检查分页".into());}
        assets.push(PageAsset{id,name:format!("第 {} 页",i+1),kind:"png".into(),size:bytes.len()});
    }
    let notes=anchors.into_iter().map(|n|{
        let asset_id=assets.get(n.page.wrapping_sub(1)).map(|a|a.id.clone()).unwrap_or_default();
        NoteAnchor{grid:grid.into(),track:n.track,index:n.index,pitch:n.pitch,measure:n.measure,asset_id,page:n.page,region:n.region}
    }).collect::<Vec<_>>();
    validate_note_anchors(&notes,"images",&assets)?;
    let mut measures=std::collections::BTreeMap::<usize,(usize,PageRegion)>::new();
    for note in &notes {
        let r=&note.region;
        measures.entry(note.measure).and_modify(|(page,span)|{
            if *page==note.page {
                let right=(span.x+span.width).max(r.x+r.width);
                let bottom=(span.y+span.height).max(r.y+r.height);
                span.x=span.x.min(r.x);span.y=span.y.min(r.y);
                span.width=right-span.x;span.height=bottom-span.y;
            }
        }).or_insert((note.page,r.clone()));
    }
    let mapping=Mapping{grid:grid.into(),enabled:true,anchors:measures.into_iter().map(|(measure,(page,region))|PageAnchor{measure,page,region:Some(region)}).collect()};
    mapping.validate("images",assets.len())?;
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut store=load(data,cid)?;
    let base=blake3::hash(format!("located-paper:{cid}:{source_fingerprint}:{}",assets.iter().map(|a|a.id.as_str()).collect::<Vec<_>>().join(":")).as_bytes()).to_hex().to_string();
    let prefix=format!("{base}-");
    if let Some(existing)=store.attachments.iter().find(|book| {
        (book.id==base||book.id.strip_prefix(&prefix).is_some_and(|suffix|!suffix.is_empty()&&suffix.bytes().all(|byte|byte.is_ascii_digit())))
            &&book.name==name&&book.format=="images"&&book.pages==assets&&book.note_anchors==notes&&book.mapping.as_ref()==Some(&mapping)
    }) {
        let id=existing.id.clone();
        // Reconcile a lost reply without changing the user's current active view or annotations.
        for (asset,bytes) in assets.iter().zip(&pages) {
            let path=asset_path(data,cid,asset)?;
            if !panthesia_core::utils::atomic_file::read_limited(&path,bytes.len()).is_ok_and(|current|current==*bytes) {
                panthesia_core::utils::atomic_file::write(&path,bytes).map_err(|error|format!("原生成谱页尚未恢复完整：{error}"))?;
            }
        }
        let mut value=describe(data,&store)?;
        value["createdPaperId"]=serde_json::json!(id);
        value["alreadySaved"]=serde_json::json!(true);
        value["changed"]=serde_json::json!(false);
        return Ok(value);
    }
    if store.attachments.len()>=40{return Err("一首曲目最多 40 份谱面附件".into());}
    let total=store.attachments.iter().flat_map(|a|&a.pages).map(|a|a.size).sum::<usize>();
    let added=pages.iter().map(Vec::len).sum::<usize>();
    if total.checked_add(added).is_none_or(|n|n>240_000_000){return Err("这首曲目的谱面附件总量超过 240 MB".into());}
    let mut id=base.clone();let mut version=2;
    while store.attachments.iter().any(|a|a.id==id){id=format!("{base}-{version}");version+=1;}
    let dir=folder(data,cid)?;
    std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let mut created:Vec<PathBuf>=Vec::new();
    for (asset,bytes) in assets.iter().zip(&pages){
        let path=asset_path(data,cid,asset)?;
        let existed=path.is_file();
        if !panthesia_core::utils::atomic_file::read_limited(&path,bytes.len()).is_ok_and(|current|current==*bytes){
            if let Err(e)=panthesia_core::utils::atomic_file::write(&path,bytes){
                if !existed {let _=panthesia_core::utils::atomic_file::discard_or_remove(&path);}
                for staged in created {let _=panthesia_core::utils::atomic_file::discard_or_remove(&staged);}
                return Err(format!("谱页写入失败：{e}"));
            }
            if !existed {created.push(path);}
        }
    }
    store.attachments.push(Attachment{id:id.clone(),name,format:"images".into(),pages:assets,view:View::default(),mapping:Some(mapping),annotations:vec![],note_anchors:notes,sources:Default::default()});
    store.active=Some(id.clone());
    if let Err(e)=save(data,&store){for staged in created {let _=panthesia_core::utils::atomic_file::discard_or_remove(&staged);}return Err(e);}
    let mut value=describe(data,&store)?;
    value["createdPaperId"]=serde_json::json!(id);
    value["alreadySaved"]=serde_json::json!(false);
    Ok(value)
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub grid: String,
    pub enabled: bool,
    pub anchors: Vec<PageAnchor>,
}
/// A reader may replace a mapping only while its displayed mapping and page order still match.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingExpectation {
    pub mapping: Option<Mapping>,
    pub pages: Vec<String>,
}
impl Mapping {
    pub fn validate(&self, format: &str, image_pages: usize) -> Result<(), String> {
        if self.grid.is_empty()
            || self.grid.len() > 160
            || self.anchors.is_empty()
            || self.anchors.len() > 5000
        {
            return Err("谱页小节对应为空或超过容量".into());
        }
        let mut last = 0;
        for a in &self.anchors {
            if let Some(r)=&a.region {r.validate()?;}
            if a.measure <= last
                || a.measure > 1_000_000
                || a.page == 0
                || a.page > 5000
                || (format == "images" && a.page > image_pages)
            {
                return Err("小节需按演奏顺序排列、不能重复；谱页需在有效范围内".into());
            }
            last = a.measure;
        }
        Ok(())
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Store {
    content_id: String,
    active: Option<String>,
    attachments: Vec<Attachment>,
}
fn folder(data: &Path, cid: &str) -> Result<PathBuf, String> {
    if cid.is_empty() || cid.len() > 160 {
        return Err("曲目身份无效".into());
    }
    Ok(data
        .join("score-attachments")
        .join(blake3::hash(cid.as_bytes()).to_hex().as_str()))
}
fn load(data: &Path, cid: &str) -> Result<Store, String> {
    let p = folder(data, cid)?.join("manifest.json");
    let s = match panthesia_core::utils::atomic_file::read_limited(&p, 512_000_000) {
        Ok(b) => {
            serde_json::from_slice::<Store>(&b).map_err(|e| format!("谱页目录读取失败：{e}"))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Store {
            content_id: cid.into(),
            ..Default::default()
        },
        Err(e) => return Err(e.to_string()),
    };
    if s.content_id != cid {
        return Err("谱页曲目身份不符".into());
    }
    Ok(s)
}
fn save(data: &Path, s: &Store) -> Result<(), String> {
    let dir = folder(data, &s.content_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(&dir.join("manifest.json"),&serde_json::to_vec(s).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
fn asset_path(data: &Path, cid: &str, a: &PageAsset) -> Result<PathBuf, String> {
    if a.id.len() != 64
        || !a.id.bytes().all(|c| c.is_ascii_hexdigit())
        || !["pdf", "png", "jpeg", "webp"].contains(&a.kind.as_str())
    {
        return Err("谱页索引无效".into());
    }
    Ok(folder(data, cid)?.join(format!("{}.{}", a.id, a.kind)))
}
fn title(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 120 {
        return Err("谱面名称需为 1 至 120 字".into());
    }
    Ok(n.into())
}
fn kind(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("单份谱面需小于 48 MB".into());
    }
    if bytes.starts_with(b"%PDF-") {
        Ok("pdf")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("png")
    } else if bytes.starts_with(&[255, 216, 255]) {
        Ok("jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("webp")
    } else {
        Err("只支持 PDF、PNG、JPEG 和 WebP；文件内容不是有效的支持格式".into())
    }
}
fn describe(data: &Path, s: &Store) -> Result<Value, String> {
    let mut v = serde_json::to_value(s).map_err(|e| e.to_string())?;
    for (a, item) in s
        .attachments
        .iter()
        .zip(v["attachments"].as_array_mut().unwrap())
    {
        for (p, out) in a.pages.iter().zip(item["pages"].as_array_mut().unwrap()) {
            out["available"] = json!(panthesia_core::utils::atomic_file::is_file(&asset_path(data, &s.content_id, p)?));
        }
    }
    Ok(v)
}
pub fn list(data: &Path, cid: &str) -> Result<Value, String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    describe(data, &load(data, cid)?)
}
/// The caller holds the workspace lock through playback installation.
/// Resolve only the requested book and page, without describing every attachment.
pub(crate) fn navigation_position(
    data: &Path, cid: &str, command: &crate::Command, file: &panthesia_music::MidiFile,
    notes: &[crate::PracticeNote], check: &impl Fn() -> Result<(), String>,
) -> Result<f64, String> {
    check()?;
    if file.content_id != cid { return Err("曲目已切换，请重新打开谱页".into()); }
    let store = load(data, cid)?;
    check()?;
    let grid = crate::practice_conditions::grid(file);
    match command {
        crate::Command::SeekPaperMeasure { id, measure, .. } => {
            let attachment = store.attachments.iter().find(|a| &a.id == id).ok_or("谱面版本已改变，请重新打开谱页")?;
            let mapping = attachment.mapping.as_ref().ok_or("该谱面没有小节对应")?;
            let anchor = mapping.anchors.iter().find(|a| a.measure == *measure).ok_or("小节对应已改变，请重新确认谱页位置")?;
            if mapping.grid != grid { return Err("小节网格已改变，请重新确认谱页位置".into()); }
            navigation_asset(data, cid, attachment, anchor.page)?;
            file.musical_time.measures.get(measure.wrapping_sub(1)).map(|bar| file.tempo_track.pulses_to_duration(bar.start_tick).as_secs_f64())
                .ok_or_else(|| "小节已不存在，请重新确认谱页位置".into())
        }
        crate::Command::SeekPaperNote { book, expected, .. } => {
            let attachment = store.attachments.iter().find(|a| &a.id == book).ok_or("谱面版本已改变，请重新打开谱页")?;
            let saved = attachment.note_anchors.iter().find(|n| n.track == expected.track && n.index == expected.index)
                .ok_or("音符位置已改变，请重新打开谱页")?;
            if saved != expected || saved.grid != grid { return Err("音符位置或小节网格已改变，请重新打开谱页".into()); }
            let asset = navigation_asset(data, cid, attachment, saved.page)?;
            if asset.id != saved.asset_id { return Err("谱页文件已变化，请重新核对音符位置".into()); }
            let mut found = None;
            for (index, note) in notes.iter().enumerate() {
                if index % 1024 == 0 { check()?; }
                if note.track_id == saved.track && note.index == saved.index {
                    if found.is_some() || note.note != saved.pitch { return Err("演奏音符已改变，请重新核对位置".into()); }
                    found = Some(note.start.as_secs_f64());
                }
            }
            let start = found.ok_or("演奏音符已改变，请重新核对位置")?;
            let measure = file.measures.partition_point(|time| time.as_secs_f64() <= start);
            if measure == 0 || measure != saved.measure { return Err("音符所在小节已改变，请重新核对位置".into()); }
            Ok(start)
        }
        _ => Err("谱页定位操作无效".into()),
    }
}
fn navigation_asset<'a>(data: &Path, cid: &str, attachment: &'a Attachment, page: usize) -> Result<&'a PageAsset, String> {
    if page == 0 { return Err("谱页已不存在".into()); }
    let asset = if attachment.format == "pdf" { attachment.pages.first() } else { attachment.pages.get(page - 1) }
        .ok_or("谱页已不存在")?;
    if !panthesia_core::utils::atomic_file::is_file(&asset_path(data, cid, asset)?) {
        return Err("谱页文件已变化，请重新核对位置".into());
    }
    Ok(asset)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperViewState {
    pub content_id: String,
    pub book: String,
    pub view: View,
    pub format: String,
    pub image_pages: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperViewSaved {
    pub saved: bool,
    pub state: PaperViewState,
}
fn view_state(cid: &str, a: &Attachment) -> PaperViewState {
    PaperViewState { content_id: cid.into(), book: a.id.clone(), view: a.view.clone(), format: a.format.clone(), image_pages: a.pages.len() }
}
pub(crate) fn read_view_locked(data: &Path, cid: &str, book: &str) -> Result<PaperViewState, String> {
    let store = load(data, cid)?;
    let a = store.attachments.iter().find(|a| a.id == book).ok_or("谱面版本已不存在，请保留阅读位置并重新选择谱面")?;
    Ok(view_state(cid, a))
}
pub(crate) fn save_view_locked(
    data: &Path, cid: &str, book: &str, mut view: View, expected: Option<&View>,
    before_commit: impl FnOnce() -> Result<(), String>,
) -> Result<PaperViewSaved, String> {
    if view.page == 0 || view.page > 5000 || !(25..=300).contains(&view.zoom) || ![0, 90, 180, 270].contains(&view.rotation) {
        return Err("阅读设置超出范围".into());
    }
    let mut store = load(data, cid)?;
    let at = store.attachments.iter().position(|a| a.id == book).ok_or("谱面版本已不存在，请保留阅读位置并重新选择谱面")?;
    let a = &mut store.attachments[at];
    if a.format == "images" {
        if a.pages.is_empty() { return Err("谱面没有可用图片页".into()); }
        view.page = view.page.min(a.pages.len());
    }
    if a.view == view { return Ok(PaperViewSaved { saved: true, state: view_state(cid, a) }); }
    if expected.is_some_and(|old| old != &a.view) {
        return Ok(PaperViewSaved { saved: false, state: view_state(cid, a) });
    }
    a.view = view;
    let state = view_state(cid, a);
    before_commit()?;
    save(data, &store)?;
    Ok(PaperViewSaved { saved: true, state })
}
fn source_bytes(path:&Path)->Result<Vec<u8>,String>{
    if !path.is_absolute(){return Err("请选择原件的完整文件位置".into());}
    let meta=std::fs::metadata(path).map_err(|e|e.to_string())?;
    if !meta.is_file() || meta.len()>MAX_BYTES as u64 {return Err("原件不是文件或超过 48 MB".into());}
    use std::io::Read;
    let mut bytes=Vec::new();std::fs::File::open(path).map_err(|e|e.to_string())?.take(MAX_BYTES as u64+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    kind(&bytes)?;Ok(bytes)
}
fn attachment_baseline(a:&Attachment)->String {blake3::hash(&serde_json::to_vec(a).unwrap()).to_hex().to_string()}
pub fn link_source(data:&Path,cid:&str,book:&str,asset:&str,path:Option<PathBuf>,baseline:Option<&str>)->Result<Value,String>{
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut store=load(data,cid)?;
    let a=store.attachments.iter_mut().find(|a|a.id==book).ok_or("谱面版本不存在")?;
    if baseline.is_some_and(|b|b!=attachment_baseline(a)){return Err("谱面或原件关联已改变，请刷新列表".into());}
    if !a.pages.iter().any(|p|p.id==asset){return Err("谱页已改变，请重新打开".into());}
    if let Some(path)=path {
        let bytes=source_bytes(&path)?;
        if blake3::hash(&bytes).to_hex().as_str()!=asset {return Err("所选文件与当前谱页内容不同。请添加为新版本，或选择内容相同的原件".into());}
        a.sources.insert(asset.into(),PaperSource{path,ignored:None});
    }else{a.sources.remove(asset);}
    save(data,&store)?;describe(data,&store)
}
pub fn inspect_sources(data:&Path,cid:&str,book:&str)->Result<Value,String>{
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let store=load(data,cid)?;
    drop(_g);let a=store.attachments.iter().find(|a|a.id==book).ok_or("谱面版本不存在")?;
    let rows:Vec<_>=a.pages.iter().enumerate().map(|(i,p)|{
        let mut row=json!({"assetId":p.id,"page":i+1,"name":p.name,"status":"unlinked"});
        if let Some(source)=a.sources.get(&p.id){
            row["path"]=json!(source.path);
            match source_bytes(&source.path){
                Ok(bytes)=>{let hash=blake3::hash(&bytes).to_hex().to_string();row["fingerprint"]=json!(hash);
                    row["status"]=json!(if hash==p.id{"same"}else if source.ignored.as_ref()==Some(&hash){"ignored"}else{"changed"});}
                Err(e)=>{row["status"]=json!(if !source.path.exists(){"missing"}else{"unavailable"});row["error"]=json!(e);}
            }
        }row
    }).collect();
    Ok(json!({"rows":rows,"baseline":attachment_baseline(a)}))
}
pub fn preview_source(data:&Path,cid:&str,book:&str,asset:&str,fingerprint:&str)->Result<Value,String>{
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let store=load(data,cid)?;
    drop(_g);let a=store.attachments.iter().find(|a|a.id==book).ok_or("谱面版本不存在")?;
    let source=a.sources.get(asset).ok_or("原件关联已改变，请重新检查")?;
    let bytes=source_bytes(&source.path)?;let hash=blake3::hash(&bytes).to_hex().to_string();
    if hash!=fingerprint || hash==asset {return Err("原件已变化，请重新检查后预览".into());}
    let k=kind(&bytes)?.to_string();
    if (a.format=="pdf")!=(k=="pdf"){return Err("原件格式已改变，请单独添加为新谱面".into());}
    let page=PageAsset{id:hash.clone(),name:source.path.file_name().unwrap_or_default().to_string_lossy().into(),kind:k,size:bytes.len()};
    let dest=asset_path(data,cid,&page)?;panthesia_core::utils::atomic_file::write(&dest,&bytes).map_err(|e|e.to_string())?;
    Ok(json!({"baseline":attachment_baseline(a),"fingerprint":hash,"asset":page,"name":a.name,"format":a.format}))
}
pub fn read_source_preview(data:&Path,cid:&str,hash:&str,k:&str)->Result<(Vec<u8>,String),String>{
    let page=PageAsset{id:hash.into(),name:String::new(),kind:k.into(),size:0};
    let bytes=source_bytes(&asset_path(data,cid,&page)?)?;
    if blake3::hash(&bytes).to_hex().as_str()!=hash || kind(&bytes)?!=k{return Err("预览缓存已变化，请重新检查".into());}
    Ok((bytes,k.into()))
}
pub fn apply_source(data:&Path,cid:&str,book:&str,asset:&str,fingerprint:&str,baseline:&str,action:&str)->Result<Value,String>{
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut store=load(data,cid)?;let at=store.attachments.iter().position(|a|a.id==book).ok_or("谱面版本不存在")?;
    let old=&store.attachments[at];
    if attachment_baseline(old)!=baseline {return Err("谱面、批注、对应或原件位置已改变，请重新检查".into());}
    let page_at=old.pages.iter().position(|p|p.id==asset).ok_or("谱页已改变")?;
    let source=old.sources.get(asset).ok_or("原件关联已移除")?.clone();
    let bytes=source_bytes(&source.path)?;let hash=blake3::hash(&bytes).to_hex().to_string();
    if hash!=fingerprint || hash==asset {return Err("原件已再次变化，请重新检查".into());}
    if action=="ignore" {store.attachments[at].sources.get_mut(asset).unwrap().ignored=Some(hash);}
    else if action=="version" {
        let k=kind(&bytes)?.to_string();
        if (old.format=="pdf")!=(k=="pdf"){return Err("原件格式已改变，请单独添加为新谱面".into());}
        if store.attachments.len()>=40 {return Err("一首曲目最多 40 份谱面附件".into());}
        let total:usize=store.attachments.iter().flat_map(|a|&a.pages).map(|p|p.size).sum();
        let extra:usize=old.pages.iter().enumerate().map(|(i,p)|if i==page_at {bytes.len()}else{p.size}).sum();
        if total+extra>240_000_000{return Err("谱面附件总量超过 240 MB".into());}
        if old.pages.iter().enumerate().any(|(i,p)|i!=page_at&&p.id==hash){return Err("更新后的图片与同一谱面另一页重复，请单独整理".into());}
        let mut new=old.clone();let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        new.id=format!("paper-update-{stamp}");new.name=format!("{} · 更新",old.name.chars().take(114).collect::<String>());
        new.mapping=None;new.annotations.clear();new.note_anchors.clear();new.view=View::default();
        new.pages[page_at]=PageAsset{id:hash.clone(),name:source.path.file_name().unwrap_or_default().to_string_lossy().into(),kind:k,size:bytes.len()};
        new.sources.remove(asset);new.sources.insert(hash.clone(),PaperSource{path:source.path,ignored:None});
        panthesia_core::utils::atomic_file::write(&asset_path(data,cid,&new.pages[page_at])?,&bytes).map_err(|e|e.to_string())?;
        store.active=Some(new.id.clone());store.attachments.push(new);
    }else{return Err("更新操作无效".into());}
    save(data,&store)?;describe(data,&store)
}
pub fn set_mapping(
    data: &Path,
    cid: &str,
    id: &str,
    mapping: Option<Mapping>,
) -> Result<Value, String> {
    set_mapping_checked(data, cid, id, mapping, None)
}
pub fn set_mapping_checked(
    data: &Path,
    cid: &str,
    id: &str,
    mapping: Option<Mapping>,
    expected: Option<MappingExpectation>,
) -> Result<Value, String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let mut s = load(data, cid)?;
    let a = s
        .attachments
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("谱面版本不存在")?;
    if let Some(expected) = expected {
        if a.mapping != expected.mapping || a.pages.iter().map(|page| page.id.clone()).collect::<Vec<_>>() != expected.pages {
            return Err("谱页顺序或小节对应已改变，请重新读取后核对。本次草稿已保留。".into());
        }
    }
    if let Some(m) = &mapping {
        m.validate(&a.format, a.pages.len())?;
    }
    a.mapping = mapping;
    save(data, &s)?;
    describe(data, &s)
}
fn transfer_id(source:&str,target:&str,id:&str)->String {blake3::hash(format!("paper-transfer:{source}:{target}:{id}").as_bytes()).to_hex().to_string()}
fn transfer_baseline(source:&Attachment,target:&Attachment)->String {blake3::hash(format!("{}:{}",attachment_baseline(source),attachment_baseline(target)).as_bytes()).to_hex().to_string()}
pub fn preview_transfer(data:&Path,cid:&str,source:&str,target:&str)->Result<Value,String>{
    if source==target{return Err("请选择不同的来源谱面".into());}
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let s=load(data,cid)?;let a=s.attachments.iter().find(|a|a.id==source).ok_or("来源谱面不存在")?;
    let b=s.attachments.iter().find(|a|a.id==target).ok_or("目标谱面不存在")?;
    let described=describe(data,&s)?;let books=described["attachments"].as_array().unwrap();
    let imported:Vec<_>=a.annotations.iter().filter(|n|b.annotations.iter().any(|t|t.id==transfer_id(source,target,&n.id))).map(|n|&n.id).collect();
    Ok(json!({"source":books.iter().find(|v|v["id"]==source),"target":books.iter().find(|v|v["id"]==target),"baseline":transfer_baseline(a,b),"imported":imported}))
}
pub fn apply_transfer(data:&Path,cid:&str,request:PaperTransfer)->Result<Value,String>{
    if request.source==request.target || request.annotations.len()>2000 || request.anchors.len()>5000 || (request.annotations.is_empty()&&request.anchors.is_empty()){return Err("请选择来源谱面和要迁移的批注或小节对应".into());}
    let lock=crate::data_locks::lock_for(data)?;let _g=lock.lock().map_err(|_|"谱页目录正忙")?;
    let mut s=load(data,cid)?;let source=s.attachments.iter().find(|a|a.id==request.source).ok_or("来源谱面不存在")?.clone();
    let target=s.attachments.iter_mut().find(|a|a.id==request.target).ok_or("目标谱面不存在")?;
    if transfer_baseline(&source,target)!=request.baseline{return Err("来源或目标谱面资料已改变，请重新审阅迁移".into());}
    let mut seen=std::collections::BTreeSet::new();let mut added=0;
    for edit in &request.annotations {
        if !seen.insert(&edit.id){return Err("迁移批注重复，未保存".into());}
        let note=source.annotations.iter().find(|n|n.id==edit.id).ok_or("来源批注已移除")?;
        let copy=Annotation{id:transfer_id(&request.source,&request.target,&edit.id),asset_id:edit.asset_id.clone(),page:edit.page,x:edit.x,y:edit.y,text:note.text.clone(),color:note.color.clone(),width:note.width,height:note.height,ink:note.ink.clone()};
        if let Some(old)=target.annotations.iter().find(|n|n.id==copy.id){if old!=&copy{return Err("这条批注已迁移且后来修改，请在目标谱面继续编辑，或取消这条迁移".into());}}
        else{target.annotations.push(copy);added+=1;}
    }
    validate_annotations(&target.annotations,&target.format,&target.pages.iter().map(|p|p.id.clone()).collect::<Vec<_>>())?;
    if !request.anchors.is_empty(){
        let mapping=source.mapping.as_ref().ok_or("来源谱面没有小节对应")?;
        let mut result=target.mapping.clone().unwrap_or(Mapping{grid:mapping.grid.clone(),enabled:false,anchors:vec![]});
        if result.grid!=mapping.grid{return Err("两份谱面的小节网格不同，请在目标谱面重新设置对应".into());}
        let mut seen=std::collections::BTreeSet::new();
        for anchor in &request.anchors{
            if !seen.insert(anchor.measure)||!mapping.anchors.iter().any(|a|a.measure==anchor.measure){return Err("来源小节对应无效或重复".into());}
            if let Some(old)=result.anchors.iter_mut().find(|a|a.measure==anchor.measure){
                if (old.page!=anchor.page||old.region!=anchor.region)&&!request.replace_anchors{return Err("目标已有同小节对应，请取消该项或明确勾选替换".into());}old.page=anchor.page;old.region=anchor.region.clone();
            }else{result.anchors.push(anchor.clone());}
        }
        result.anchors.sort_by_key(|a|a.measure);result.enabled=false;result.validate(&target.format,target.pages.len())?;target.mapping=Some(result);
    }
    save(data,&s)?;Ok(json!({"added":added,"anchors":request.anchors.len(),"saved":true}))
}
pub fn add(
    data: &Path,
    cid: &str,
    name: &str,
    bytes: Vec<u8>,
    append: Option<&str>,
) -> Result<Value, String> {
    let k = kind(&bytes)?.to_owned();
    let name = title(name)?;
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let mut s = load(data, cid)?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    if let Some(id) = append {
        let a = s
            .attachments
            .iter()
            .find(|a| a.id == id)
            .ok_or("谱面版本不存在")?;
        if a.format != "images" || k == "pdf" {
            return Err("图片谱面只能追加图片；PDF 请添加为新版本".into());
        }
        if a.pages.len() >= 80 {
            return Err("一份图片谱面最多 80 页".into());
        }
        if a.pages.iter().any(|p| p.id == hash) {
            return Err("这张图片已经在该谱面中".into());
        }
    } else if let Some(a) = s
        .attachments
        .iter()
        .find(|a| a.pages.len() == 1 && a.pages[0].id == hash)
    {
        let id = a.id.clone();
        let dest = asset_path(data, cid, &a.pages[0])?;
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        panthesia_core::utils::atomic_file::write(&dest, &bytes).map_err(|e| e.to_string())?;
        s.active = Some(id);
        save(data, &s)?;
        return describe(data, &s);
    } else if s.attachments.len() >= 40 {
        return Err("一首曲目最多 40 份谱面附件".into());
    }
    let total: usize = s
        .attachments
        .iter()
        .flat_map(|a| &a.pages)
        .map(|a| a.size)
        .sum();
    if total + bytes.len() > 240_000_000 {
        return Err("这首曲目的谱面附件总量超过 240 MB".into());
    }
    let asset = PageAsset {
        id: hash.clone(),
        name: name.clone(),
        kind: k.clone(),
        size: bytes.len(),
    };
    let dest = asset_path(data, cid, &asset)?;
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(&dest, &bytes).map_err(|e| e.to_string())?;
    if let Some(id) = append {
        let a = s.attachments.iter_mut().find(|a| a.id == id).unwrap();
        a.pages.push(asset);
        s.active = Some(id.into());
    } else {
        let mut id = hash.clone();
        let mut version = 2;
        while s.attachments.iter().any(|a| a.id == id) {
            id = format!("{hash}-{version}");
            version += 1;
        }

        s.attachments.push(Attachment {
            id: id.clone(),
            name,
            format: if k == "pdf" { "pdf" } else { "images" }.into(),
            pages: vec![asset],
            view: View::default(),
            mapping: None,
            annotations: vec![],
            note_anchors: vec![],
            sources: Default::default(),
        });
        s.active = Some(id);
    }
    save(data, &s)?;
    describe(data, &s)
}
pub fn read(data: &Path, cid: &str, id: &str, page: usize) -> Result<(Vec<u8>, String), String> {
    read_expected(data, cid, id, page, None)
}
pub fn read_expected(data: &Path, cid: &str, id: &str, page: usize, expected_asset: Option<&str>) -> Result<(Vec<u8>, String), String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let s = load(data, cid)?;
    drop(_g);
    let a = s
        .attachments
        .iter()
        .find(|a| a.id == id)
        .ok_or("谱面版本不存在")?;
    let p = a.pages.get(page).ok_or("谱页不存在")?;
    if expected_asset.is_some_and(|expected| p.id != expected) {return Err("谱页或页序已改变，请重新读取谱本后继续".into());}
    let path = asset_path(data, cid, p)?;
    let b = panthesia_core::utils::atomic_file::read_limited(&path,MAX_BYTES).map_err(|e| e.to_string())?;
    if blake3::hash(&b).to_hex().as_str() != p.id {
        return Err("谱页文件内容已改变，请重新导入".into());
    }
    Ok((b, p.kind.clone()))
}
pub fn update(
    data: &Path,
    cid: &str,
    id: Option<&str>,
    action: &str,
    name: Option<&str>,
    view: Option<View>,
    page: usize,
    direction: i32,
) -> Result<Value, String> {
    update_with_pages(data, cid, id, action, name, view, page, direction, None)
}
pub(crate) fn update_with_pages(
    data: &Path, cid: &str, id: Option<&str>, action: &str, name: Option<&str>,
    view: Option<View>, page: usize, direction: i32, expected_pages: Option<&[String]>,
) -> Result<Value, String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let mut s = load(data, cid)?;
    if action == "select" {
        if let Some(id) = id {
            if !s.attachments.iter().any(|a| a.id == id) {
                return Err("谱面版本不存在".into());
            }
        }
        s.active = id.map(String::from);
    } else {
        let id = id.ok_or("谱面版本未指定")?;
        let at = s
            .attachments
            .iter()
            .position(|a| a.id == id)
            .ok_or("谱面版本不存在")?;
        if ["movePage", "removePage"].contains(&action) && expected_pages.is_some_and(|expected| {
            expected.len() > 80 || !s.attachments[at].pages.iter().map(|p| &p.id).eq(expected.iter())
        }) {
            return Err("谱页次序已改变，本次操作未重复执行。请刷新谱面后重新选择要整理的页面。".into());
        }
        match action {
            "rename" => s.attachments[at].name = title(name.ok_or("名称未指定")?)?,
            "remove" => {
                s.attachments.remove(at);
                if s.active.as_deref() == Some(id) {
                    s.active = s.attachments.first().map(|a| a.id.clone());
                }
            }
            "view" => {
                let mut v = view.ok_or("阅读设置未指定")?;
                if v.page == 0
                    || v.page > 5000
                    || v.zoom < 25
                    || v.zoom > 300
                    || ![0, 90, 180, 270].contains(&v.rotation)
                {
                    return Err("阅读设置超出范围".into());
                }
                if s.attachments[at].format == "images" {
                    v.page = v.page.min(s.attachments[at].pages.len());
                }
                s.attachments[at].view = v;
            }
            "movePage" | "removePage" => {
                let a = &mut s.attachments[at];
                if a.format != "images" || page >= a.pages.len() {
                    return Err("图片谱页不存在".into());
                }
                if action == "removePage" {
                    if a.pages.len() == 1 {
                        return Err("最后一页不能移除，请移除整个版本".into());
                    }
                    let removed = a.pages.remove(page);
                    a.annotations.retain(|n| n.asset_id != removed.id);
                    a.note_anchors.retain(|n| n.asset_id != removed.id);
                    for n in &mut a.note_anchors { if n.page>page+1 { n.page-=1; } }
                    if let Some(m) = &mut a.mapping {
                        m.anchors.retain(|v| v.page != page + 1);
                        for v in &mut m.anchors {
                            if v.page > page + 1 {
                                v.page -= 1;
                            }
                        }
                        if m.anchors.is_empty() {
                            a.mapping = None;
                        }
                    }
                    a.view.page = a.view.page.min(a.pages.len());
                } else {
                    let next = page as i32 + direction;
                    if ![-1, 1].contains(&direction) || next < 0 || next as usize >= a.pages.len() {
                        return Err("谱页已在边界".into());
                    }
                    a.pages.swap(page, next as usize);
                    for n in &mut a.note_anchors { if n.page==page+1 { n.page=next as usize+1; } else if n.page==next as usize+1 { n.page=page+1; } }
                    if let Some(m) = &mut a.mapping {
                        for v in &mut m.anchors {
                            if v.page == page + 1 {
                                v.page = next as usize + 1;
                            } else if v.page == next as usize + 1 {
                                v.page = page + 1;
                            }
                        }
                    }
                    a.view.page = next as usize + 1;
                }
            }
            _ => return Err("谱面操作无效".into()),
        }
    }
    save(data, &s)?;
    describe(data, &s)
}
pub fn summaries(data: &Path) -> std::collections::BTreeMap<String, (usize, Vec<String>)> {
    summaries_checked(data, &|| Ok(())).unwrap_or_default()
}
pub(crate) fn summaries_checked(
    data: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<std::collections::BTreeMap<String, (usize, Vec<String>)>, String> {
    check()?;
    let mut result = std::collections::BTreeMap::new();
    let Ok(dirs) = std::fs::read_dir(data.join("score-attachments")) else {
        return Ok(result);
    };
    for dir in dirs.take(10_000).flatten() {
        check()?;
        let Ok(bytes) = panthesia_core::utils::atomic_file::read_hint(
            &dir.path().join("manifest.json"),
            64_000_000,
        ) else {
            continue;
        };
        check()?;
        let Ok(store) = serde_json::from_slice::<Store>(&bytes) else {
            continue;
        };
        result.insert(
            store.content_id,
            (
                store.attachments.len(),
                store.attachments.into_iter().map(|a| a.name).collect(),
            ),
        );
    }
    check()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn located_paper_binary_upload_accepts_large_page_and_rejects_partial_frame(){
        let metadata=serde_json::to_vec(&serde_json::json!({
            "content_id":"piece","score_revision":3,"source_fingerprint":"source",
            "mapping_token":"map","name":"长谱","page_count":1,
            "anchors":[{"track":0,"index":0,"pitch":60,"measure":1,"page":1,
                "rendererId":"n1","region":{"x":0.1,"y":0.2,"width":0.03,"height":0.02}}]
        })).unwrap();
        let mut page=vec![0u8;3_100_000];page[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let mut frame=b"NLP1".to_vec();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());frame.extend_from_slice(&metadata);
        frame.extend_from_slice(&(page.len() as u32).to_le_bytes());frame.extend_from_slice(&page);
        let (meta,pages)=decode_located_paper_upload(&frame).unwrap();
        assert_eq!(meta.page_count,1);assert_eq!(pages[0].len(),3_100_000);
        assert!(decode_located_paper_upload(&frame[..frame.len()-1]).is_err());
        frame.push(0);assert!(decode_located_paper_upload(&frame).is_err());
    }
    #[test]
    fn batch_note_anchors_is_atomic_and_preserves_unmentioned_marks(){
        let root=std::env::temp_dir().join(format!("paper-note-batch-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let cid="batch-song";
        let added=add(&root,cid,"演奏谱",b"\x89PNG\r\n\x1a\nfirst".to_vec(),None).unwrap();
        let book=added["active"].as_str().unwrap().to_owned();
        let asset=added["attachments"][0]["pages"][0]["id"].as_str().unwrap().to_owned();
        let region=PageRegion{x:0.2,y:0.3,width:0.1,height:0.06};
        let draft=|pitch,measure|NoteAnchorDraft{pitch,measure,asset_id:asset.clone(),page:1,region:region.clone()};
        edit_note_anchor(&root,cid,&book,0,0,Some(draft(60,1)),None,"grid").unwrap();
        let hand:NoteAnchor=serde_json::from_value(list(&root,cid).unwrap()["attachments"][0]["noteAnchors"][0].clone()).unwrap();
        let edits=vec![NoteAnchorEdit{track:0,index:1,draft:draft(62,1),expected:None},NoteAnchorEdit{track:0,index:2,draft:draft(64,1),expected:None}];
        let saved=batch_note_anchors(&root,cid,&book,edits,"grid").unwrap();
        let anchors=saved["attachments"][0]["noteAnchors"].as_array().unwrap();
        assert_eq!(anchors.len(),3);
        assert!(serde_json::from_value::<NoteAnchor>(anchors[0].clone()).unwrap()==hand);
        let invalid=vec![NoteAnchorEdit{track:0,index:3,draft:draft(65,1),expected:None},NoteAnchorEdit{track:0,index:0,draft:draft(67,1),expected:None}];
        assert!(batch_note_anchors(&root,cid,&book,invalid,"grid").is_err());
        assert_eq!(list(&root,cid).unwrap()["attachments"][0]["noteAnchors"].as_array().unwrap().len(),3);
        let duplicate=vec![NoteAnchorEdit{track:0,index:3,draft:draft(65,1),expected:None},NoteAnchorEdit{track:0,index:3,draft:draft(67,1),expected:None}];
        assert!(batch_note_anchors(&root,cid,&book,duplicate,"grid").is_err());
        assert_eq!(list(&root,cid).unwrap()["attachments"][0]["noteAnchors"].as_array().unwrap().len(),3);
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn located_paper_publishes_pages_mapping_and_notes_together(){
        let root=std::env::temp_dir().join(format!("paper-located-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let cid="located-song";
        let pages=vec![b"\x89PNG\r\n\x1a\npage-one".to_vec(),b"\x89PNG\r\n\x1a\npage-two".to_vec()];
        let region=PageRegion{x:0.2,y:0.3,width:0.1,height:0.06};
        let anchors=vec![LocatedNoteDraft{track:0,index:0,pitch:60,measure:1,page:1,renderer_id:"n1".into(),region:region.clone()},LocatedNoteDraft{track:0,index:1,pitch:62,measure:2,page:2,renderer_id:"n2".into(),region:region.clone()}];
        let invalid=vec![anchors[0].clone(),LocatedNoteDraft{page:3,..anchors[1].clone()}];
        assert!(create_located_paper(&root,cid,"已定位谱",pages.clone(),invalid,"grid","source").is_err());
        assert_eq!(list(&root,cid).unwrap()["attachments"].as_array().unwrap().len(),0);
        let saved=create_located_paper(&root,cid,"已定位谱",pages.clone(),anchors,"grid","source").unwrap();
        let book=&saved["attachments"][0];
        assert_eq!(book["pages"].as_array().unwrap().len(),2);
        assert_eq!(book["noteAnchors"].as_array().unwrap().len(),2);
        assert_eq!(book["mapping"]["anchors"][1]["measure"],2);
        assert_eq!(book["mapping"]["anchors"][1]["page"],2);
        assert_eq!(book["noteAnchors"][1]["assetId"],book["pages"][1]["id"]);
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn note_anchor_survives_mapping_and_page_move_then_expires_on_page_removal(){
        let root=std::env::temp_dir().join(format!("paper-note-anchors-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let cid="note-anchor-song";
        let added=add(&root,cid,"演奏谱",b"\x89PNG\r\n\x1a\nfirst".to_vec(),None).unwrap();
        let book=added["active"].as_str().unwrap().to_string();
        let first=added["attachments"][0]["pages"][0]["id"].as_str().unwrap().to_string();
        let added=add(&root,cid,"第二页",b"\x89PNG\r\n\x1a\nsecond".to_vec(),Some(&book)).unwrap();
        let second=added["attachments"][0]["pages"][1]["id"].as_str().unwrap().to_string();
        let region=PageRegion{x:0.2,y:0.3,width:0.1,height:0.06};
        let draft=NoteAnchorDraft{pitch:60,measure:2,asset_id:second.clone(),page:2,region:region.clone()};
        let updated=edit_note_anchor(&root,cid,&book,1,5,Some(draft),None,"grid-test").unwrap();
        assert_eq!(updated["attachments"][0]["noteAnchors"][0]["index"],5);
        assert_eq!(updated["attachments"][0]["noteAnchors"][0]["assetId"],second);
        let old:NoteAnchor=serde_json::from_value(updated["attachments"][0]["noteAnchors"][0].clone()).unwrap();
        assert!(edit_note_anchor(&root,cid,&book,1,5,Some(NoteAnchorDraft{pitch:61,measure:2,asset_id:second.clone(),page:2,region:region.clone()}),None,"grid-test").is_err());
        set_mapping(&root,cid,&book,Some(Mapping{grid:"grid-test".into(),enabled:true,anchors:vec![PageAnchor{measure:1,page:1,region:None}]})).unwrap();
        assert_eq!(list(&root,cid).unwrap()["attachments"][0]["noteAnchors"][0]["pitch"],60);
        let moved=update(&root,cid,Some(&book),"movePage",None,None,1,-1).unwrap();
        assert_eq!(moved["attachments"][0]["pages"][0]["id"],second);
        assert_eq!(moved["attachments"][0]["noteAnchors"][0]["page"],1);
        assert!(edit_note_anchor(&root,cid,&book,1,5,None,Some(old),"grid-test").is_err());
        let removed=update(&root,cid,Some(&book),"removePage",None,None,0,0).unwrap();
        assert_eq!(removed["attachments"][0]["pages"][0]["id"],first);
        assert!(removed["attachments"][0]["noteAnchors"].is_null());
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn copies_reading_state_reordering_and_identity_are_durable() {
        let root = std::env::temp_dir().join(format!(
            "score-attachments-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let cid = "piano-score";
        let b = b"\x89PNG\r\n\x1a\nfirst".to_vec();
        let s = add(&root, cid, "第一页", b.clone(), None).unwrap();
        let id = s["active"].as_str().unwrap();
        assert_eq!(read(&root, cid, id, 0).unwrap().0, b);
        assert!(read(&root, "another", id, 0).is_err());
        let s = add(
            &root,
            cid,
            "第二页",
            b"\x89PNG\r\n\x1a\nsecond".to_vec(),
            Some(id),
        )
        .unwrap();
        assert_eq!(s["attachments"][0]["pages"].as_array().unwrap().len(), 2);
        update(
            &root,
            cid,
            Some(id),
            "view",
            None,
            Some(View {
                page: 2,
                zoom: 150,
                fit: false,
                rotation: 90,
            }),
            0,
            0,
        )
        .unwrap();
        update(&root, cid, Some(id), "movePage", None, None, 1, -1).unwrap();
        assert_eq!(
            list(&root, cid).unwrap()["attachments"][0]["pages"][0]["name"],
            "第二页"
        );
        assert_eq!(
            list(&root, cid).unwrap()["attachments"][0]["view"]["zoom"],
            150
        );
        assert!(add(&root, cid, "错误", b"<svg>script</svg>".to_vec(), None).is_err());
        assert!(add(&root, cid, "PDF", b"%PDF-test".to_vec(), Some(id)).is_err());
        update(&root, cid, Some(id), "remove", None, None, 0, 0).unwrap();
        assert!(
            list(&root, cid).unwrap()["attachments"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(
            folder(&root, cid)
                .unwrap()
                .join(format!("{}.png", blake3::hash(&b).to_hex()))
                .exists()
        );
    }
}


pub fn list_verified(data: &Path, cid: &str) -> Result<Value, String> {
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let store = load(data, cid)?;
    drop(_g);
    let mut v = describe(data, &store)?;
    for (book, item) in store
        .attachments
        .iter()
        .zip(v["attachments"].as_array_mut().unwrap())
    {
        for (asset, page) in book.pages.iter().zip(item["pages"].as_array_mut().unwrap()) {
            let path = asset_path(data, cid, asset)?;
            let status = if std::fs::metadata(&path).is_ok_and(|m| m.len() != asset.size as u64) {
                "changed"
            } else {
                match panthesia_core::utils::atomic_file::read_limited(&path,MAX_BYTES) {
                    Ok(bytes) => {
                        if blake3::hash(&bytes).to_hex().as_str() == asset.id {
                            "ready"
                        } else {
                            "changed"
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::NotFound {
                            "missing"
                        } else {
                            "unreadable"
                        }
                    }
                }
            };
            page["status"] = json!(status);
            page["available"] = json!(status == "ready");
        }
    }
    Ok(v)
}

pub fn repair(
    data: &Path,
    cid: &str,
    id: &str,
    page: usize,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    let k = kind(&bytes)?;
    let lock = crate::data_locks::lock_for(data)?;
    let _g = lock.lock().map_err(|_| "谱页目录正忙")?;
    let s = load(data, cid)?;
    let a = s
        .attachments
        .iter()
        .find(|a| a.id == id)
        .ok_or("待修复谱面不存在")?;
    let asset = a.pages.get(page).ok_or("待修复谱页不存在")?;
    if asset.kind != k
        || asset.size != bytes.len()
        || blake3::hash(&bytes).to_hex().as_str() != asset.id
    {
        return Err("文件内容与原谱页不符；请选择原文件修复，或添加为新版本".into());
    }
    let path = asset_path(data, cid, asset)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    panthesia_core::utils::atomic_file::write(&path,&bytes).map_err(|e|e.to_string())?;
    Ok(json!({"updated":true,"id":id,"page":page}))
}
