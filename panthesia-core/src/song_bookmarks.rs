//! Named musical positions belong to a source performance, independent of practice transforms.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub name: String,
    pub tick: u64,
}
impl Bookmark {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 160
            || self.id.starts_with("midi-")
            || self.id.chars().any(char::is_control)
        {
            return Err("书签编号无效".into());
        }
        if self.name.trim().is_empty()
            || self.name.chars().count() > 80
            || self.name.chars().any(char::is_control)
        {
            return Err("书签名称需 1–80 个字，不能包含控制字符".into());
        }
        if self.tick > 9_007_199_254_740_991 {
            return Err("书签位置超过支持范围".into());
        }
        Ok(())
    }
}
pub fn validate(rows: &[Bookmark]) -> Result<(), String> {
    if rows.len() > 200 {
        return Err("每份演奏最多保存 200 个书签".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for row in rows {
        row.validate()?;
        if !ids.insert(&row.id) {
            return Err("书签编号重复".into());
        }
    }
    Ok(())
}
