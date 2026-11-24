//! `locate`: find a song's real file from a file manager that only knows a path relative to its
//! own library (Keel gives plugins no absolute paths). Candidates are the given roots and the
//! song folder (`song_index`); a match must have the stated size, so a same-named file
//! elsewhere is never taken for the song.
use crate::song_index;
use serde_json::json;
use std::path::{Component, Path, PathBuf};

const WALK_LIMIT: usize = 400_000;

fn size_matches(path: &Path, size: Option<u64>) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && size.is_none_or(|s| meta.len() == s),
        Err(_) => false,
    }
}

/// `relative` joined to each root, also without its leading folders (a linked folder's own
/// name may or may not be part of the relative path); then a walk of `walk` by file name.
pub fn locate(relative: &str, size: Option<u64>, roots: &[PathBuf], walk: Option<&Path>) -> Result<PathBuf, String> {
    let parts: Vec<&str> = relative.split(['/', '\\']).filter(|p| !p.is_empty() && *p != ".").collect();
    if parts.is_empty() || parts.iter().any(|p| *p == "..") || Path::new(relative).components().any(|c| matches!(c, Component::Prefix(_) | Component::RootDir)) {
        return Err("路径应为资源库内的相对路径".into());
    }
    for root in roots {
        for skip in 0..parts.len() {
            let candidate = parts[skip..].iter().fold(root.clone(), |p, part| p.join(part));
            if size_matches(&candidate, size) {
                return Ok(candidate);
            }
        }
    }
    let name = parts[parts.len() - 1];
    let Some(walk) = walk else { return Err("找不到这首歌：没有设置曲目文件夹".into()) };
    let mut found = Vec::new();
    let mut stack = vec![walk.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > WALK_LIMIT {
                break;
            }
            let path = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => {
                    if entry.file_name() != song_index::INDEX_FOLDER {
                        stack.push(path);
                    }
                }
                Ok(t) if t.is_file() && entry.file_name().to_str().is_some_and(|n| n.eq_ignore_ascii_case(name)) && size_matches(&path, size) => found.push(path),
                _ => {}
            }
        }
    }
    // Same name and size in several folders: keep those sharing the most trailing folders.
    let shared = |path: &PathBuf| {
        let names: Vec<String> = path.components().rev().filter_map(|c| c.as_os_str().to_str().map(str::to_lowercase)).collect();
        names.iter().zip(parts.iter().rev()).take_while(|(a, b)| **a == b.to_lowercase()).count()
    };
    let best = found.iter().map(shared).max().unwrap_or(0);
    found.retain(|path| shared(path) == best);
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(format!("曲目文件夹中找不到“{name}”")),
        n => Err(format!("曲目文件夹中有 {n} 个同名同大小的“{name}”，无法确定是哪一个")),
    }
}

/// Command line: `locate <relative path> [--size <bytes>] [--root <folder>]…`. Prints
/// `{"path": …}` or `{"error": …}`. The song folder comes from the data root's settings.
pub fn run(args: &[std::ffi::OsString], data: &Path) -> (i32, String) {
    let mut relative = None;
    let mut size = None;
    let mut roots = Vec::new();
    let mut error = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.to_str() {
            Some("--json") => {}
            Some("--size") => match iter.next().and_then(|v| v.to_str()).and_then(|v| v.parse().ok()) {
                Some(value) => size = Some(value),
                None => error = Some("--size 应为字节数".to_string()),
            },
            Some("--root") => match iter.next() {
                Some(root) => roots.push(PathBuf::from(root)),
                None => error = Some("--root 后应写文件夹".to_string()),
            },
            Some(flag) if flag.starts_with("--") => error = Some(format!("未知参数：{flag}")),
            Some(value) if relative.is_none() => relative = Some(value.to_string()),
            _ => error = Some("只能查找一个文件".into()),
        }
    }
    let song_folder = song_index::configured_root(data);
    roots.extend(song_folder.clone());
    let result = match (error, relative) {
        (Some(e), _) => Err(e),
        (None, None) => Err("用法：panthesia locate <库内相对路径> [--size 字节数] [--root 文件夹]".into()),
        (None, Some(relative)) => locate(&relative, size, &roots, song_folder.as_deref()),
    };
    match result {
        Ok(path) => (0, json!({"path": path}).to_string()),
        Err(e) => (1, json!({"error": e}).to_string()),
    }
}
